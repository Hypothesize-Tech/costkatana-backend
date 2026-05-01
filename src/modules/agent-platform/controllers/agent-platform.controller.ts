import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  MessageEvent,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Observable } from 'rxjs';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AgentDefinitionService } from '../services/agent-definition.service';
import { AgentTemplateService } from '../services/agent-template.service';
import { AgentDeploymentService } from '../services/agent-deployment.service';
import { TextToAgentService } from '../services/text-to-agent.service';
import {
  AgentRunnerService,
  AGENT_RUN_EVENT_PREFIX,
} from '../services/agent-runner.service';
import {
  CreateAgentDto,
  PublishVersionDto,
  ResumeRunDto,
  TestRunDto,
  UpdateAgentDto,
  UpdateDagDto,
} from '../dto/agent-platform.dto';
import type { AgentDag } from '../interfaces/dag.interface';

const EMPTY_DAG: AgentDag = { nodes: [], edges: [] };
const RUN_EVENT_SUFFIXES = [
  'step.start',
  'step.end',
  'paused',
  'run.end',
  'run.error',
];

@Controller('api/agent-platform')
@UseGuards(JwtAuthGuard)
export class AgentPlatformController {
  constructor(
    private readonly agentDefinitionService: AgentDefinitionService,
    private readonly agentTemplateService: AgentTemplateService,
    private readonly deploymentService: AgentDeploymentService,
    private readonly textToAgentService: TextToAgentService,
    private readonly runner: AgentRunnerService,
    private readonly events: EventEmitter2,
  ) {}

  @Post('text-to-agent')
  @HttpCode(HttpStatus.OK)
  async textToAgent(@Body() body: { description: string }) {
    return this.textToAgentService.generate(body?.description ?? '');
  }

  @Get('templates')
  async listTemplates() {
    const items = await this.agentTemplateService.list();
    return { items };
  }

  @Post('agents')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: { id: string },
    @Body() body: CreateAgentDto,
  ) {
    if (body.templateSlug) {
      const { agent, version } = await this.agentTemplateService.cloneToAgent(
        user.id,
        body.templateSlug,
        body.name,
        body.projectId,
        body.teamId,
      );
      return { agent: agent.toObject(), version: version.toObject() };
    }
    const { agent, version } = await this.agentDefinitionService.create(
      user.id,
      body.name,
      body.description,
      EMPTY_DAG,
      undefined,
      body.projectId,
      body.teamId,
    );
    return {
      agent: agent.toObject(),
      version: version.toObject(),
    };
  }

  @Get('agents')
  async list(
    @CurrentUser() user: { id: string },
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
  ) {
    const items = await this.agentDefinitionService.listForUser(user.id, {
      projectId,
      status,
    });
    return { items };
  }

  @Get('agents/:id')
  async get(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    const result = await this.agentDefinitionService.findById(user.id, id);
    return {
      agent: result.agent.toObject(),
      currentVersion: result.currentVersion?.toObject() ?? null,
    };
  }

  @Patch('agents/:id')
  async update(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: UpdateAgentDto,
  ) {
    const agent = await this.agentDefinitionService.update(user.id, id, body);
    return { agent: agent.toObject() };
  }

  @Delete('agents/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ): Promise<void> {
    await this.agentDefinitionService.remove(user.id, id);
  }

  @Put('agents/:id/dag')
  async putDag(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: UpdateDagDto,
  ) {
    const { version, validation } = await this.agentDefinitionService.putDag(
      user.id,
      id,
      body.dag,
      body.changelog,
    );
    return {
      version: version.toObject(),
      validation: {
        ok: validation.ok,
        issues: validation.issues,
      },
    };
  }

  @Post('agents/:id/publish')
  @HttpCode(HttpStatus.OK)
  async publish(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: PublishVersionDto,
  ) {
    const result = await this.agentDefinitionService.publish(
      user.id,
      id,
      body.versionId,
      body.changelog,
    );
    return {
      agent: result.agent.toObject(),
      version: result.version.toObject(),
    };
  }

  @Post('agents/:id/test-run')
  @HttpCode(HttpStatus.ACCEPTED)
  async testRun(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: TestRunDto,
  ) {
    // If body.dag is provided, save it as a new draft version first so the
    // run inherits a real `agentVersionId` (simpler than ad-hoc plans).
    let agentVersionId: string | undefined;
    if (body.dag) {
      const { version } = await this.agentDefinitionService.putDag(
        user.id,
        id,
        body.dag,
        'test-run draft',
      );
      agentVersionId = String(version._id);
    }

    const tenant = await this.agentDefinitionService.resolveTenant(user.id);
    const result = await this.runner.startRun({
      agentDefinitionId: id,
      agentVersionId,
      organizationId: String(tenant.organizationId),
      userId: user.id,
      mode: 'test',
      input: body.input,
    });
    return {
      runId: result.runId,
      streamUrl: `/api/agent-platform/runs/${result.runId}/stream`,
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
          subscriber.next({
            type: suffix,
            data: payload as Record<string, unknown>,
          } as MessageEvent);
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

  @Post('runs/:runId/resume')
  @HttpCode(HttpStatus.OK)
  async resumeRun(
    @Param('runId') runId: string,
    @Body() body: ResumeRunDto,
  ) {
    await this.runner.resume(runId, body.checkpointResponse);
    return { runId };
  }

  @Post('deployments')
  @HttpCode(HttpStatus.CREATED)
  async createDeployment(
    @CurrentUser() user: { id: string },
    @Body()
    body: {
      agentId: string;
      versionId: string;
      channel: 'embed-widget' | 'api' | 'webhook';
      originAllowlist?: string[];
      rateLimit?: { perMinPerIp?: number; perMinPerSession?: number };
      theme?: { primary?: string; surface?: string; position?: string };
      welcomeMessage?: string;
    },
  ) {
    const tenant = await this.agentDefinitionService.resolveTenant(user.id);
    const deployment = await this.deploymentService.create(
      user.id,
      String(tenant.organizationId),
      {
        agentDefinitionId: body.agentId,
        agentVersionId: body.versionId,
        channel: body.channel,
        originAllowlist: body.originAllowlist,
        rateLimit: body.rateLimit,
        theme: body.theme,
        welcomeMessage: body.welcomeMessage,
      },
    );
    return { deployment: deployment.toObject() };
  }

  @Get('deployments')
  async listDeployments(
    @CurrentUser() user: { id: string },
    @Query('agentId') agentId?: string,
  ) {
    const tenant = await this.agentDefinitionService.resolveTenant(user.id);
    const items = await this.deploymentService.listForOrg(
      String(tenant.organizationId),
      agentId,
    );
    return { items };
  }

  @Patch('deployments/:id')
  async updateDeployment(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body()
    body: {
      originAllowlist?: string[];
      rateLimit?: { perMinPerIp?: number; perMinPerSession?: number };
      theme?: { primary?: string; surface?: string; position?: string };
      welcomeMessage?: string;
      status?: 'active' | 'paused';
    },
  ) {
    const tenant = await this.agentDefinitionService.resolveTenant(user.id);
    const deployment = await this.deploymentService.update(
      String(tenant.organizationId),
      id,
      body,
    );
    return { deployment: deployment.toObject() };
  }
}
