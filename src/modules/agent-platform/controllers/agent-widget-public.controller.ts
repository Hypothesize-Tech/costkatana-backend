import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  MessageEvent,
  NotFoundException,
  Param,
  Post,
  Req,
  SetMetadata,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Observable } from 'rxjs';
import { Request } from 'express';

import { AgentDeploymentService } from '../services/agent-deployment.service';
import { WidgetSessionService } from '../services/widget-session.service';
import {
  AgentRunnerService,
  AGENT_RUN_EVENT_PREFIX,
} from '../services/agent-runner.service';
import {
  WidgetSessionGuard,
  WIDGET_SESSION_PUBLIC,
} from '../guards/widget-session.guard';

const RUN_EVENT_SUFFIXES = [
  'step.start',
  'step.end',
  'paused',
  'run.end',
  'run.error',
];

const WidgetSessionPublic = () => SetMetadata(WIDGET_SESSION_PUBLIC, true);

interface WidgetSessionContext {
  sessionId: string;
  deploymentId: string;
  originHash: string;
}

@Controller('api/public/widget')
@UseGuards(WidgetSessionGuard)
export class AgentWidgetPublicController {
  constructor(
    private readonly deployments: AgentDeploymentService,
    private readonly widgetSessions: WidgetSessionService,
    private readonly runner: AgentRunnerService,
    private readonly events: EventEmitter2,
  ) {}

  @Post(':publicId/session')
  @WidgetSessionPublic()
  @HttpCode(HttpStatus.CREATED)
  async createSession(
    @Param('publicId') publicId: string,
    @Headers('origin') origin?: string,
  ) {
    const deployment = await this.deployments.findByPublicId(publicId);
    if (!deployment) throw new NotFoundException('Deployment not found');
    if (deployment.status !== 'active') {
      throw new BadRequestException('Deployment is paused');
    }
    this.deployments.assertOriginAllowed(deployment, origin);
    const session = this.widgetSessions.issueSession(
      String(deployment._id),
      origin ?? '',
    );
    return {
      sessionId: session.sessionId,
      sessionToken: session.sessionToken,
      theme: deployment.theme,
      welcomeMessage: deployment.welcomeMessage,
    };
  }

  @Post('message')
  @HttpCode(HttpStatus.ACCEPTED)
  async postMessage(
    @Req() req: Request & { widgetSession?: WidgetSessionContext },
    @Body() body: { message: unknown; metadata?: Record<string, unknown> },
  ) {
    const session = req.widgetSession;
    if (!session) throw new BadRequestException('Missing widget session');

    const dep = await this.deployments.findById(session.deploymentId);
    if (!dep) {
      throw new NotFoundException('Deployment not found');
    }

    if (dep.status !== 'active') {
      throw new BadRequestException('Deployment is paused');
    }

    const result = await this.runner.startRun({
      agentDefinitionId: String(dep.agentDefinitionId),
      agentVersionId: String(dep.agentVersionId),
      organizationId: String(dep.organizationId),
      deploymentId: String(dep._id),
      widgetSessionId: session.sessionId,
      mode: 'live',
      input: body.message,
    });

    return {
      runId: result.runId,
      streamUrl: `/api/public/widget/runs/${result.runId}/stream`,
    };
  }

  @Get('runs/:runId/stream')
  @Sse()
  streamRun(@Param('runId') runId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const handlers: Array<{ event: string; fn: (...a: unknown[]) => void }> =
        [];
      let closed = false;

      for (const suffix of RUN_EVENT_SUFFIXES) {
        const event = `${AGENT_RUN_EVENT_PREFIX}.${runId}.${suffix}`;
        const fn = (payload: unknown) => {
          if (closed) return;
          // Public stream redacts cost/tokens.
          const data = redact(payload);
          subscriber.next({ type: suffix, data } as MessageEvent);
          if (suffix === 'run.end' || suffix === 'run.error') {
            closed = true;
            subscriber.complete();
          }
        };
        this.events.on(event, fn);
        handlers.push({ event, fn });
      }

      return () => {
        closed = true;
        for (const { event, fn } of handlers) this.events.off(event, fn);
      };
    });
  }
}

function redact(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  const copy: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
  delete copy.tokens;
  delete copy.costUsd;
  return copy;
}
