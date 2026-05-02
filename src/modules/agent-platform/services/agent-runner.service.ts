import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Model, Types } from 'mongoose';

import {
  AgentRun,
  AgentRunDocument,
  AgentRunStatus,
} from '../../../schemas/agent-platform/agent-run.schema';
import {
  AgentRunStep,
  AgentRunStepDocument,
} from '../../../schemas/agent-platform/agent-run-step.schema';
import {
  AgentVersion,
  AgentVersionDocument,
} from '../../../schemas/agent-platform/agent-version.schema';
import {
  AgentDefinition,
  AgentDefinitionDocument,
} from '../../../schemas/agent-platform/agent-definition.schema';
import type {
  CompiledPlan,
  DagNode,
} from '../interfaces/dag.interface';
import type { RunContext } from '../node-executors/base-node-executor';
import { NodeExecutorRegistry } from '../node-executors/node-executor.registry';
import { AgentCompilerService } from './agent-compiler.service';

interface StartRunOptions {
  agentDefinitionId: string;
  agentVersionId?: string; // defaults to currentVersionId
  organizationId: string;
  userId?: string;
  deploymentId?: string;
  widgetSessionId?: string;
  mode: 'test' | 'live';
  input: unknown;
}

interface StartRunResult {
  runId: string;
  status: AgentRunStatus;
}

const RUN_EVENT_PREFIX = 'agent-platform.run';
const eventName = (runId: string, suffix: string) =>
  `${RUN_EVENT_PREFIX}.${runId}.${suffix}`;

/** Wrap a Mongoose save() with a timeout so a slow MongoDB doesn't stall the run loop. */
const saveWithTimeout = <T extends { save(): Promise<unknown> }>(
  doc: T,
  ms = 8_000,
): Promise<void> =>
  Promise.race([
    doc.save().then(() => undefined),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`MongoDB save timed out after ${ms}ms`)), ms),
    ),
  ]);

export const AGENT_RUN_EVENT_PREFIX = RUN_EVENT_PREFIX;
export { eventName as agentRunEventName };

@Injectable()
export class AgentRunnerService {
  private readonly logger = new Logger(AgentRunnerService.name);

  constructor(
    @InjectModel(AgentRun.name)
    private readonly runModel: Model<AgentRunDocument>,
    @InjectModel(AgentRunStep.name)
    private readonly stepModel: Model<AgentRunStepDocument>,
    @InjectModel(AgentVersion.name)
    private readonly versionModel: Model<AgentVersionDocument>,
    @InjectModel(AgentDefinition.name)
    private readonly defModel: Model<AgentDefinitionDocument>,
    private readonly registry: NodeExecutorRegistry,
    private readonly compiler: AgentCompilerService,
    private readonly events: EventEmitter2,
  ) {}

  async startRun(opts: StartRunOptions): Promise<StartRunResult> {
    const def = await this.defModel.findById(opts.agentDefinitionId);
    if (!def) throw new NotFoundException('Agent not found');

    const versionId = opts.agentVersionId ?? def.currentVersionId?.toString();
    if (!versionId) {
      throw new BadRequestException('Agent has no version to run');
    }
    const version = await this.versionModel.findById(versionId);
    if (!version) throw new NotFoundException('Version not found');

    let plan: CompiledPlan | undefined =
      version.compiledPlan as unknown as CompiledPlan | undefined;
    if (!plan) {
      const result = this.compiler.compile(version.dag as any);
      if (!result.ok || !result.compiled) {
        throw new BadRequestException({
          message: 'Agent version failed to compile',
          issues: result.issues,
        });
      }
      plan = result.compiled;
    }

    const run = await this.runModel.create({
      agentDefinitionId: def._id,
      agentVersionId: version._id,
      organizationId: new Types.ObjectId(opts.organizationId),
      userId: opts.userId ? new Types.ObjectId(opts.userId) : undefined,
      deploymentId: opts.deploymentId
        ? new Types.ObjectId(opts.deploymentId)
        : undefined,
      widgetSessionId: opts.widgetSessionId,
      status: 'running',
      mode: opts.mode,
      input: opts.input,
      startedAt: new Date(),
    });

    // Fire-and-forget — caller subscribes to SSE for live updates.
    void this.executePlan(String(run._id), plan, opts.input).catch((err) => {
      this.logger.error('Run failed unexpectedly', err);
    });

    return { runId: String(run._id), status: 'running' };
  }

  /** Return current DB state for SSE replay on late-connecting clients. */
  async getRunSnapshot(runId: string) {
    const run = await this.runModel.findById(runId).lean();
    if (!run) return null;
    const steps = await this.stepModel
      .find({ agentRunId: run._id })
      .sort({ startedAt: 1 })
      .lean();
    return { run, steps };
  }

  /** Fetch up to `limit` completed runs for a widget session, oldest first. */
  async getRecentRunsForSession(
    widgetSessionId: string,
    limit = 3,
  ): Promise<Array<{ input: unknown; output?: unknown }>> {
    const runs = await this.runModel
      .find({ widgetSessionId, status: 'succeeded' })
      .sort({ startedAt: -1 })
      .limit(limit)
      .select('input output')
      .lean();
    return runs.reverse();
  }

  /** Resume a paused run (e.g., after a checkpoint approval). */
  async resume(runId: string, checkpointResponse: unknown): Promise<void> {
    const run = await this.runModel.findById(runId);
    if (!run) throw new NotFoundException('Run not found');
    if (run.status !== 'paused_checkpoint') {
      throw new BadRequestException(
        `Run is not paused (current status: ${run.status})`,
      );
    }
    const version = await this.versionModel.findById(run.agentVersionId);
    if (!version)
      throw new NotFoundException('Version was deleted; cannot resume run');
    const plan = version.compiledPlan as unknown as CompiledPlan;
    if (!plan) throw new BadRequestException('Version has no compiled plan');

    // Stash the checkpoint response onto the paused step so downstream
    // executors can read it from `outputs[currentNodeId]`.
    if (run.currentNodeId) {
      const step = await this.stepModel
        .findOne({ agentRunId: run._id, nodeId: run.currentNodeId })
        .sort({ startedAt: -1 });
      if (step) {
        step.output = checkpointResponse;
        step.status = 'succeeded';
        step.endedAt = new Date();
        await saveWithTimeout(step);
      }
    }

    run.status = 'running';
    run.pausedAt = undefined;
    await saveWithTimeout(run);

    void this.executePlan(String(run._id), plan, run.input, {
      resumeFromNodeId: run.currentNodeId ?? undefined,
    }).catch((err) => this.logger.error('Resume failed', err));
  }

  /**
   * Execute a compiled plan. The walk uses the topological order, but
   * if-else nodes can override the next-node selection by returning
   * `preferredBranchLabel` on their result. Edges with mismatched labels
   * are skipped (so a `false` branch won't fire on a `true` decision).
   */
  private async executePlan(
    runId: string,
    plan: CompiledPlan,
    runInput: unknown,
    options?: { resumeFromNodeId?: string },
  ): Promise<void> {
    const run = await this.runModel.findById(runId);
    if (!run) {
      this.logger.warn(`Run ${runId} not found at execute time`);
      return;
    }

    const ctx: RunContext = {
      runId,
      agentDefinitionId: String(run.agentDefinitionId),
      agentVersionId: String(run.agentVersionId),
      organizationId: String(run.organizationId),
      runInput,
      outputs: {},
      memory: {},
    };

    const visited = new Set<string>();
    const skipped = new Set<string>();
    let lastOutput: unknown;

    // We re-derive the topological walk on each step so branch labels can
    // mask off downstream nodes. A node is eligible when all its incoming
    // edges have either succeeded or been masked off.
    const queue: string[] = [];
    const enqueueIfReady = (id: string) => {
      if (visited.has(id) || skipped.has(id)) return;
      const incoming = plan.incomingEdges[id] ?? [];
      const allReady = incoming.every(
        (e) => visited.has(e.source) || skipped.has(e.source),
      );
      const anyArrives = incoming.some((e) => visited.has(e.source));
      if (allReady && (incoming.length === 0 || anyArrives)) {
        if (!queue.includes(id)) queue.push(id);
      }
    };

    if (options?.resumeFromNodeId) {
      // Resuming after a checkpoint — mark the checkpoint as visited and
      // re-seed downstream successors.
      visited.add(options.resumeFromNodeId);
      const stepDoc = await this.stepModel
        .findOne({ agentRunId: run._id, nodeId: options.resumeFromNodeId })
        .sort({ startedAt: -1 });
      if (stepDoc?.output !== undefined) {
        ctx.outputs[options.resumeFromNodeId] = stepDoc.output;
        lastOutput = stepDoc.output;
      }
      for (const edge of plan.outgoingEdges[options.resumeFromNodeId] ?? []) {
        enqueueIfReady(edge.target);
      }
    } else {
      for (const id of plan.entryNodeIds) queue.push(id);
    }

    try {
      while (queue.length > 0) {
        const nodeId = queue.shift()!;
        if (visited.has(nodeId) || skipped.has(nodeId)) continue;
        const node = plan.nodeIndex[nodeId];
        if (!node) continue;

        run.currentNodeId = nodeId;
        await saveWithTimeout(run);

        const stepInput = this.assembleNodeInput(node, plan, ctx);
        const step = await this.stepModel.create({
          agentRunId: run._id,
          nodeId,
          nodeType: node.type,
          status: 'running',
          input: stepInput,
          startedAt: new Date(),
        });

        this.events.emit(eventName(runId, 'step.start'), {
          runId,
          nodeId,
          nodeType: node.type,
          input: stepInput,
        });

        const startedAt = Date.now();
        try {
          const executor = this.registry.get(node.type);
          const result = await executor.execute(
            ctx,
            (node.data?.config ?? {}) as Record<string, unknown>,
            stepInput,
          );

          step.output = result.output;
          step.status = 'succeeded';
          step.tokens = result.tokens ?? { in: 0, out: 0 };
          step.costUsd = result.cost ?? 0;
          step.latencyMs = Date.now() - startedAt;
          step.traceMeta = result.traceMeta ?? {};
          step.endedAt = new Date();

          if (result.pause) {
            // Checkpoint — mark step paused, set run paused, stop walking.
            step.status = 'paused';
            // Store pause metadata so SSE replay can reconstruct the event.
            step.traceMeta = {
              ...(step.traceMeta ?? {}),
              pauseReason: result.pause.reason,
              pausePayload: result.pause.payload,
            };
            await saveWithTimeout(step);
            run.status = 'paused_checkpoint';
            run.pausedAt = new Date();
            run.currentNodeId = nodeId;
            await saveWithTimeout(run);
            this.events.emit(eventName(runId, 'paused'), {
              runId,
              nodeId,
              reason: result.pause.reason,
              payload: result.pause.payload,
            });
            return;
          }

          await saveWithTimeout(step);
          ctx.outputs[nodeId] = result.output;
          lastOutput = result.output;
          visited.add(nodeId);
          run.tokens = {
            in: (run.tokens?.in ?? 0) + (result.tokens?.in ?? 0),
            out: (run.tokens?.out ?? 0) + (result.tokens?.out ?? 0),
          };
          run.costUsd = (run.costUsd ?? 0) + (result.cost ?? 0);
          await saveWithTimeout(run);

          this.events.emit(eventName(runId, 'step.end'), {
            runId,
            nodeId,
            nodeType: node.type,
            output: result.output,
            tokens: step.tokens,
            costUsd: step.costUsd,
            latencyMs: step.latencyMs,
          });

          // Decide which outgoing edges to follow.
          const outgoing = plan.outgoingEdges[nodeId] ?? [];
          if (result.preferredBranchLabel !== undefined) {
            for (const edge of outgoing) {
              if (edge.label === result.preferredBranchLabel) {
                enqueueIfReady(edge.target);
              } else {
                this.markBranchSkipped(edge.target, plan, skipped, visited);
              }
            }
          } else {
            for (const edge of outgoing) {
              enqueueIfReady(edge.target);
            }
          }
        } catch (err) {
          step.error = {
            message: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          };
          step.status = 'failed';
          step.endedAt = new Date();
          step.latencyMs = Date.now() - startedAt;
          await saveWithTimeout(step);
          run.status = 'failed';
          run.error = {
            message: step.error.message,
            nodeId,
          };
          run.endedAt = new Date();
          await saveWithTimeout(run);
          this.events.emit(eventName(runId, 'run.error'), {
            runId,
            nodeId,
            error: step.error,
          });
          return;
        }
      }

      run.status = 'succeeded';
      run.output = lastOutput;
      run.endedAt = new Date();
      await saveWithTimeout(run);
      this.events.emit(eventName(runId, 'run.end'), {
        runId,
        output: run.output,
        tokens: run.tokens,
        costUsd: run.costUsd,
      });
    } catch (err) {
      this.logger.error('Run loop crashed', err);
      run.status = 'failed';
      run.error = {
        message: err instanceof Error ? err.message : String(err),
      };
      run.endedAt = new Date();
      await saveWithTimeout(run);
      this.events.emit(eventName(runId, 'run.error'), {
        runId,
        error: run.error,
      });
    }
  }

  /**
   * Assemble a node's input by shallow-merging outputs from its incoming
   * edges. The result is what the executor sees as `input`. Single-source
   * nodes pass the upstream output through verbatim.
   */
  private assembleNodeInput(
    node: DagNode,
    plan: CompiledPlan,
    ctx: RunContext,
  ): unknown {
    const incoming = plan.incomingEdges[node.id] ?? [];
    if (incoming.length === 0) {
      return ctx.runInput ?? {};
    }
    if (incoming.length === 1) {
      return ctx.outputs[incoming[0].source] ?? {};
    }
    const merged: Record<string, unknown> = {};
    for (const edge of incoming) {
      const src = ctx.outputs[edge.source];
      if (src && typeof src === 'object') {
        Object.assign(merged, src);
      } else if (src !== undefined) {
        merged[edge.source] = src;
      }
    }
    return merged;
  }

  /**
   * Mark `nodeId` and everything transitively downstream of it as skipped,
   * so they don't execute when an if-else takes a different branch.
   */
  private markBranchSkipped(
    nodeId: string,
    plan: CompiledPlan,
    skipped: Set<string>,
    visited: Set<string>,
  ): void {
    if (skipped.has(nodeId) || visited.has(nodeId)) return;
    skipped.add(nodeId);
    for (const edge of plan.outgoingEdges[nodeId] ?? []) {
      // Only skip if the target has no other path in (i.e., would only be
      // reachable from this skipped branch).
      const incoming = plan.incomingEdges[edge.target] ?? [];
      const allUpstreamSkipped = incoming.every(
        (e) => skipped.has(e.source) || (e.source === nodeId),
      );
      if (allUpstreamSkipped) {
        this.markBranchSkipped(edge.target, plan, skipped, visited);
      }
    }
  }
}
