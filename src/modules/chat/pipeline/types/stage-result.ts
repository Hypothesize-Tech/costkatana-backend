/**
 * Result returned by every pipeline stage.
 *
 * Discriminated by `success`. On `success: true`, the orchestrator merges
 * `mutates` into the context and pushes any provided `rollback` onto the
 * compensation stack. On `success: false`, the orchestrator stops the
 * pipeline, runs accumulated rollbacks in reverse order, and surfaces
 * `error` as a typed `StageError` to the caller.
 */
import type { StageContext, StageError } from './stage-context';

export interface StageOk {
  success: true;
  /**
   * Optional partial of `StageContext`. Whatever a stage sets here gets
   * shallow-merged onto the live context. Stages should *not* mutate the
   * context object directly; use this field instead for testability.
   *
   * Note: deep-nested fields like `errors` / `rollbacks` are append-only
   * and managed by the orchestrator — do not put them in `mutates`.
   */
  mutates?: Partial<Omit<StageContext, 'errors' | 'rollbacks'>>;
  /** Compensating action to run if a *later* stage fails. */
  rollback?: () => Promise<void>;
  /**
   * If true, the orchestrator stops running subsequent stages but still
   * returns success with the current context. Set when a stage handled
   * the request fully (e.g. integration command, plan-pending-approval).
   */
  shortCircuit?: boolean;
}

export interface StageErr {
  success: false;
  error: StageError;
}

export type StageResult = StageOk | StageErr;

/**
 * Contract every pipeline stage implements. Concrete stages are NestJS
 * `@Injectable()` classes; the orchestrator pulls them out of the DI
 * container and calls `run(ctx)` in a fixed order.
 */
export interface PipelineStage {
  /** Stable, human-readable identifier — used in logs and `StageError.stage`. */
  readonly name: string;
  /**
   * Execute the stage.
   *
   * Implementations:
   * 1. Read what they need from `ctx`.
   * 2. Do their work (DB / LLM / external calls).
   * 3. Return a `StageResult` — never mutate `ctx` directly.
   * 4. Throw only for truly exceptional cases; prefer returning `StageErr`.
   */
  run(ctx: StageContext): Promise<StageResult>;
}

/** Convenience for stages that only need to mutate. */
export function ok(
  mutates?: StageOk['mutates'],
  rollback?: StageOk['rollback'],
): StageOk {
  return { success: true, mutates, rollback };
}

/** Short-circuit success — the orchestrator will stop running further stages. */
export function shortCircuit(
  mutates?: StageOk['mutates'],
  rollback?: StageOk['rollback'],
): StageOk {
  return { success: true, mutates, rollback, shortCircuit: true };
}

/** Convenience for stages that hit an unrecoverable error. */
export function fail(
  stage: string,
  code: string,
  message: string,
  cause?: unknown,
  retryable = false,
): StageErr {
  return {
    success: false,
    error: { stage, code, message, cause, retryable },
  };
}
