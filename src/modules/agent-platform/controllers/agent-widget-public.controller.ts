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
  Res,
  SetMetadata,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Observable } from 'rxjs';
import { Request, Response } from 'express';

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

    // Fetch last 3 completed turns so the LLM has conversation context.
    const recentRuns = await this.runner.getRecentRunsForSession(session.sessionId, 3);
    const chatHistory = recentRuns.flatMap((run) => {
      const userMsg =
        typeof run.input === 'string'
          ? run.input
          : ((run.input as Record<string, unknown>)?.message as string | undefined) ?? '';
      const assistantMsg =
        ((run.output as Record<string, unknown>)?.text as string | undefined) ?? '';
      if (!userMsg && !assistantMsg) return [];
      return [
        { role: 'user', content: userMsg },
        { role: 'assistant', content: assistantMsg },
      ] as Array<{ role: string; content: string }>;
    });

    const result = await this.runner.startRun({
      agentDefinitionId: String(dep.agentDefinitionId),
      agentVersionId: String(dep.agentVersionId),
      organizationId: String(dep.organizationId),
      deploymentId: String(dep._id),
      widgetSessionId: session.sessionId,
      mode: 'live',
      input: { message: body.message, chatHistory },
    });

    return {
      runId: result.runId,
      streamUrl: `/api/public/widget/runs/${result.runId}/stream`,
    };
  }

  @Get('bundle.js')
  @WidgetSessionPublic()
  serveBundle(@Res() res: Response): void {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(WIDGET_JS_BUNDLE);
  }

  @Get('runs/:runId/stream')
  @WidgetSessionPublic()
  @Sse()
  streamRun(@Param('runId') runId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const handlers: Array<{ event: string; fn: (...a: unknown[]) => void }> =
        [];
      let closed = false;
      // Track which events we've already pushed to the client so the live
      // EventEmitter and the DB poller don't double-emit.
      const seen = new Set<string>();

      const safeEmit = (type: string, key: string, payload: unknown) => {
        if (closed || seen.has(key)) return;
        seen.add(key);
        subscriber.next({ type, data: redact(payload) } as MessageEvent);
        if (type === 'run.end' || type === 'run.error') {
          closed = true;
          subscriber.complete();
        }
      };

      // ECS runs N tasks behind ALB; POST /message and GET /stream often
      // land on different containers. EventEmitter2 is in-process, so the
      // /stream container won't see live events from the run container.
      // The DB poller below covers that case — it reads the run/step state
      // every second and emits any newly-observed transitions.
      const subscribeLive = () => {
        for (const suffix of RUN_EVENT_SUFFIXES) {
          const event = `${AGENT_RUN_EVENT_PREFIX}.${runId}.${suffix}`;
          const fn = (payload: unknown) => {
            const p = (payload ?? {}) as { nodeId?: string };
            const key = p.nodeId
              ? `${suffix}:${p.nodeId}`
              : `${suffix}:run`;
            safeEmit(suffix, key, payload);
          };
          this.events.on(event, fn);
          handlers.push({ event, fn });
        }
      };

      const replayFromSnapshot = async () => {
        if (closed) return;
        const snapshot = await this.runner.getRunSnapshot(runId);
        if (closed || !snapshot) return;
        const { run, steps } = snapshot;

        for (const step of steps) {
          safeEmit(
            'step.start',
            `step.start:${step.nodeId}`,
            { runId, nodeId: step.nodeId, nodeType: step.nodeType, input: step.input },
          );
          if (step.status === 'succeeded') {
            safeEmit(
              'step.end',
              `step.end:${step.nodeId}`,
              { runId, nodeId: step.nodeId, nodeType: step.nodeType, output: step.output, latencyMs: step.latencyMs },
            );
          } else if (step.status === 'failed') {
            safeEmit(
              'step.end',
              `step.end:${step.nodeId}`,
              { runId, nodeId: step.nodeId, nodeType: step.nodeType, output: step.output },
            );
          } else if (step.status === 'paused') {
            const meta = (step.traceMeta ?? {}) as Record<string, unknown>;
            safeEmit(
              'paused',
              `paused:${step.nodeId}`,
              { runId, nodeId: step.nodeId, reason: meta.pauseReason, payload: meta.pausePayload },
            );
          }
        }

        if (run.status === 'succeeded') {
          safeEmit('run.end', 'run.end:run', { runId, output: run.output });
        } else if (run.status === 'failed') {
          safeEmit('run.error', 'run.error:run', { runId, error: run.error });
        }
      };

      // Subscribe to live events first so we don't miss anything that fires
      // between the snapshot read and the live subscription on the same node.
      subscribeLive();
      void replayFromSnapshot();

      // Poll the DB every second until the run reaches a terminal state.
      // Necessary because the run may execute on a different container than
      // the one serving this SSE stream — bgSave will eventually reflect
      // step transitions in the DB even when local EventEmitter doesn't.
      const pollHandle = setInterval(() => {
        if (closed) {
          clearInterval(pollHandle);
          return;
        }
        void replayFromSnapshot();
      }, 1_000);

      // Belt-and-braces: hard timeout at 90s so a stuck run doesn't leak
      // an open SSE forever. The widget will reconnect or surface the error.
      const hardStop = setTimeout(() => {
        if (closed) return;
        safeEmit('run.error', 'run.error:run', {
          runId,
          error: { message: 'SSE stream timed out (90s)' },
        });
      }, 90_000);

      return () => {
        closed = true;
        clearInterval(pollHandle);
        clearTimeout(hardStop);
        for (const { event, fn } of handlers) this.events.off(event, fn);
      };
    });
  }
}

function redact(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  const copy: Record<string, unknown> = {
    ...(payload as Record<string, unknown>),
  };
  delete copy.tokens;
  delete copy.costUsd;
  return copy;
}

/* ---------- Embed widget JS served at GET /api/public/widget/bundle.js ---------- */
// Loaded at module init from `widget-bundle.embed.js`. The .js file is copied
// into dist/ via the `assets` rule in nest-cli.json, so the runtime path is
// stable in both dev (ts source) and prod (compiled). Edit the .js directly —
// no template-literal escaping needed.
const WIDGET_BUNDLE_PATH = join(__dirname, '..', 'widget-bundle.embed.js');
const WIDGET_JS_BUNDLE = readFileSync(WIDGET_BUNDLE_PATH, 'utf8');
