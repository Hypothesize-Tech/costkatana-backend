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
import type { NodeExecutor, RunContext } from '../node-executors/base-node-executor';
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

/**
 * Per-doc save chain. Mongoose rejects parallel `.save()` calls on the same
 * instance with "Can't save() the same doc multiple times in parallel" — so we
 * serialize bgSave calls per document by chaining them on a WeakMap-tracked
 * promise. Each save still completes in the background; subsequent saves just
 * wait for the previous one to finish before starting.
 */
const docSaveChains = new WeakMap<object, Promise<unknown>>();

/**
 * Best-effort, non-blocking Mongoose save. Resolves immediately (fire-and-forget).
 * Failures are logged but never propagate — the run loop and SSE events must
 * not be gated on DB writes so the chat widget stays responsive even when
 * MongoDB is under load. Saves on the same doc instance are serialized to
 * avoid Mongoose's parallel-save guard.
 */
const bgSave = (
  doc: object & { save(): Promise<unknown> },
  label: string,
  logger: { warn(msg: string): void },
  ms = 8_000,
): void => {
  const previous = docSaveChains.get(doc) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() =>
      Promise.race([
        doc.save(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms),
        ),
      ]),
    )
    .catch((err) =>
      logger.warn(
        `bgSave(${label}) failed: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  docSaveChains.set(doc, next);
};

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
        bgSave(step, 'resume.step', this.logger);
      }
    }

    run.status = 'running';
    run.pausedAt = undefined;
    bgSave(run, 'resume.run', this.logger);

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
      mode: run.mode,
      widgetSessionId: run.widgetSessionId,
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

        // Track progress in DB (best-effort — never block the run loop on this).
        run.currentNodeId = nodeId;
        bgSave(run, 'currentNodeId', this.logger);

        const stepInput = this.assembleNodeInput(node, plan, ctx);

        // Create the step record so late-connecting SSE clients can replay it.
        // If the create itself times out (MongoDB down), we skip the record but
        // continue executing so the widget still gets a response.
        let step: AgentRunStepDocument | null = null;
        try {
          step = await Promise.race([
            this.stepModel.create({
              agentRunId: run._id,
              nodeId,
              nodeType: node.type,
              status: 'running',
              input: stepInput,
              startedAt: new Date(),
            }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('step create timed out')), 5_000),
            ),
          ]);
        } catch (e) {
          this.logger.warn(
            `Step create failed for ${nodeId} (continuing without DB record): ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
        }

        // Emit step.start regardless of whether the DB record was created.
        this.events.emit(eventName(runId, 'step.start'), {
          runId,
          nodeId,
          nodeType: node.type,
          input: stepInput,
        });

        const startedAt = Date.now();
        let result: Awaited<ReturnType<NodeExecutor['execute']>>;
        try {
          const executor = this.registry.get(node.type);
          result = await executor.execute(
            ctx,
            (node.data?.config ?? {}) as Record<string, unknown>,
            stepInput,
          );
        } catch (err) {
          // Executor threw — emit run.error immediately so SSE gets a terminal
          // event. Persist the failure to DB in the background.
          const errMsg = err instanceof Error ? err.message : String(err);
          const errStack = err instanceof Error ? err.stack : undefined;

          if (step) {
            step.error = { message: errMsg, stack: errStack };
            step.status = 'failed';
            step.endedAt = new Date();
            step.latencyMs = Date.now() - startedAt;
            bgSave(step, 'step.failed', this.logger);
          }

          run.status = 'failed';
          run.error = { message: errMsg, nodeId };
          run.endedAt = new Date();
          bgSave(run, 'run.failed', this.logger);

          // Emit BEFORE returning so SSE always receives a terminal event.
          this.events.emit(eventName(runId, 'run.error'), {
            runId,
            nodeId,
            error: { message: errMsg, stack: errStack },
          });
          return;
        }

        const latencyMs = Date.now() - startedAt;

        if (result.pause) {
          // Checkpoint — the run must pause here so the user can approve.
          // We DO need the pause state persisted before emitting so that a
          // resume call can find it, but we still emit if the save fails.
          if (step) {
            step.status = 'paused';
            step.output = result.output;
            step.latencyMs = latencyMs;
            step.endedAt = new Date();
            step.traceMeta = {
              ...(result.traceMeta ?? {}),
              pauseReason: result.pause.reason,
              pausePayload: result.pause.payload,
            };
            bgSave(step, 'step.paused', this.logger);
          }
          run.status = 'paused_checkpoint';
          run.pausedAt = new Date();
          run.currentNodeId = nodeId;
          bgSave(run, 'run.paused', this.logger);

          this.events.emit(eventName(runId, 'paused'), {
            runId,
            nodeId,
            reason: result.pause.reason,
            payload: result.pause.payload,
          });
          return;
        }

        // --- Normal step success ---

        // Update in-memory context immediately so the next node can run.
        ctx.outputs[nodeId] = result.output;
        lastOutput = result.output;
        visited.add(nodeId);
        run.tokens = {
          in: (run.tokens?.in ?? 0) + (result.tokens?.in ?? 0),
          out: (run.tokens?.out ?? 0) + (result.tokens?.out ?? 0),
        };
        run.costUsd = (run.costUsd ?? 0) + (result.cost ?? 0);

        // Emit step.end immediately — don't wait for DB writes.
        this.events.emit(eventName(runId, 'step.end'), {
          runId,
          nodeId,
          nodeType: node.type,
          output: result.output,
          tokens: result.tokens ?? { in: 0, out: 0 },
          costUsd: result.cost ?? 0,
          latencyMs,
        });

        // Persist to DB in background.
        if (step) {
          step.output = result.output;
          step.status = 'succeeded';
          step.tokens = result.tokens ?? { in: 0, out: 0 };
          step.costUsd = result.cost ?? 0;
          step.latencyMs = latencyMs;
          step.traceMeta = result.traceMeta ?? {};
          step.endedAt = new Date();
          bgSave(step, 'step.succeeded', this.logger);
        }
        bgSave(run, 'run.progress', this.logger);

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
      }

      // All nodes finished — emit run.end immediately, persist in background.
      run.status = 'succeeded';
      run.output = lastOutput;
      run.endedAt = new Date();

      this.events.emit(eventName(runId, 'run.end'), {
        runId,
        output: run.output,
        tokens: run.tokens,
        costUsd: run.costUsd,
      });

      bgSave(run, 'run.succeeded', this.logger);
    } catch (err) {
      // Unexpected crash in the run loop itself (not an executor error).
      this.logger.error('Run loop crashed', err);
      run.status = 'failed';
      run.error = { message: err instanceof Error ? err.message : String(err) };
      run.endedAt = new Date();

      this.events.emit(eventName(runId, 'run.error'), {
        runId,
        error: run.error,
      });

      bgSave(run, 'run.crashed', this.logger);
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
