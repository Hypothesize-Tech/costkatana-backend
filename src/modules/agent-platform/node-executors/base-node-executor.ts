import type { NodeType } from '../interfaces/dag.interface';

/**
 * Run-scoped context handed to every executor. The runner builds it once
 * per agent run and threads it through the topological walk.
 */
export interface RunContext {
  runId: string;
  agentDefinitionId: string;
  agentVersionId: string;
  organizationId: string;
  /** Original `input` from the caller (test-run body or widget message). */
  runInput: unknown;
  /**
   * Map of nodeId -> output produced so far. Executors reach into this
   * (or use the convenience helpers on the runner) to assemble their input
   * from upstream node outputs.
   */
  outputs: Record<string, unknown>;
  /** Per-run scratchpad executors can write to (memory-write, etc.). */
  memory: Record<string, unknown>;
  /** "test" runs are launched from the canvas; "live" runs come from production traffic. */
  mode?: 'test' | 'live';
  /**
   * Set when the run was started by an embedded chat widget. Executors that
   * normally require human interaction (e.g., `checkpoint`) should auto-skip
   * when this is present, since a chat user has no way to approve checkpoints.
   */
  widgetSessionId?: string;
  /** Optional cancellation signal. */
  signal?: AbortSignal;
}

export interface NodeExecutorResult<O = unknown> {
  output: O;
  cost?: number;
  tokens?: { in: number; out: number };
  /** Free-form trace metadata persisted onto the AgentRunStep document. */
  traceMeta?: Record<string, unknown>;
  /**
   * Set by control-flow nodes (if-else) to instruct the runner which
   * outgoing edge label to follow next. The runner consults this in
   * preference to the topological default.
   */
  preferredBranchLabel?: string;
  /** Set by checkpoint executors to pause the run. */
  pause?: { reason?: string; payload?: unknown };
}

export interface NodeExecutor<I = unknown, O = unknown> {
  readonly type: NodeType;
  execute(
    ctx: RunContext,
    config: Record<string, unknown>,
    input: I,
  ): Promise<NodeExecutorResult<O>>;
}

export const NODE_EXECUTOR = Symbol('NODE_EXECUTOR');
