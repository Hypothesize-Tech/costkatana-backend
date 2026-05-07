/**
 * Validates model-issued tool-call arguments before dispatch.
 *
 * The model can hallucinate arguments — extra fields, wrong types, missing
 * required keys, structurally invalid shapes. Without validation those flow
 * straight into the integration call where they may execute unexpected
 * operations or crash the handler. Zod schemas declared per-tool are checked
 * here and reject malformed calls cleanly with a structured `tool_result_error`
 * the model can recover from.
 *
 * Tools opt in by registering a schema via `registerToolSchema`. Tools without
 * a schema fall through with a one-time warning so legacy callers don't break.
 */
import type { ZodSchema, ZodError } from 'zod';
import { Logger } from '@nestjs/common';

export interface ToolArgValidationOk<T = unknown> {
  ok: true;
  args: T;
}

export interface ToolArgValidationErr {
  ok: false;
  error: 'invalid_args' | 'unknown_tool';
  message: string;
  /** Field paths (Zod issues) when available, for error messages back to the model. */
  issues?: Array<{ path: string; message: string }>;
}

export type ToolArgValidationResult<T = unknown> =
  | ToolArgValidationOk<T>
  | ToolArgValidationErr;

const REGISTRY = new Map<string, ZodSchema<unknown>>();
const WARNED_MISSING = new Set<string>();
const logger = new Logger('ToolArgValidator');

/**
 * Register a Zod schema for a tool by name. Call once at module init time.
 * Re-registering the same name overwrites silently (safe for hot-reload).
 */
export function registerToolSchema(
  toolName: string,
  schema: ZodSchema<unknown>,
): void {
  REGISTRY.set(toolName, schema);
}

/** For tests / hot-reload teardown. */
export function clearToolSchemas(): void {
  REGISTRY.clear();
  WARNED_MISSING.clear();
}

/**
 * Validate model-issued args. Returns a discriminated union — callers should
 * `if (!result.ok)` short-circuit and feed the error back to the model as a
 * tool_result_error rather than executing.
 */
export function validateToolArgs<T = unknown>(
  toolName: string,
  rawArgs: unknown,
): ToolArgValidationResult<T> {
  const schema = REGISTRY.get(toolName);
  if (!schema) {
    if (!WARNED_MISSING.has(toolName)) {
      WARNED_MISSING.add(toolName);
      logger.warn(
        `No Zod schema registered for tool "${toolName}" — args will pass through unvalidated. Register one via registerToolSchema().`,
      );
    }
    return { ok: true, args: rawArgs as T };
  }

  // Bedrock sometimes delivers args as a stringified JSON blob; normalise.
  let candidate = rawArgs;
  if (typeof rawArgs === 'string') {
    try {
      candidate = JSON.parse(rawArgs);
    } catch {
      return {
        ok: false,
        error: 'invalid_args',
        message: `Tool "${toolName}" received non-JSON string args.`,
      };
    }
  }

  const result = schema.safeParse(candidate);
  if (result.success) {
    return { ok: true, args: result.data as T };
  }
  const zerr = result.error as ZodError;
  return {
    ok: false,
    error: 'invalid_args',
    message: `Tool "${toolName}" args failed validation`,
    issues: zerr.issues.map((i) => ({
      path: i.path.join('.') || '(root)',
      message: i.message,
    })),
  };
}

/**
 * Convenience: format a validation error as the body of a `tool_result` block
 * so it can be fed straight back into the conversation. Keeps wording stable
 * so tests can assert it.
 */
export function formatValidationErrorForToolResult(
  err: ToolArgValidationErr,
): string {
  const issuesPart = err.issues?.length
    ? ' Issues:\n' +
      err.issues
        .map((i) => `  - ${i.path}: ${i.message}`)
        .join('\n')
    : '';
  return [
    `tool_result_error=${err.error}`,
    err.message + issuesPart,
    'Re-issue the tool call with corrected arguments. Do not invent unknown fields.',
  ].join('\n');
}
