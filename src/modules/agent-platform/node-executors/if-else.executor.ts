import { Injectable } from '@nestjs/common';
import {
  NodeExecutor,
  NodeExecutorResult,
  RunContext,
} from './base-node-executor';

interface IfElseConfig {
  /**
   * Simple branch predicate: read `path` from input, compare with `op` to
   * `value`. Truthy result -> "true" branch, otherwise "false" branch.
   */
  simple?: {
    path: string;
    op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'truthy';
    value?: unknown;
  };
  /**
   * JSONLogic predicate (supported subset). Provided for forward-compat
   * with the canvas UI; runs after `simple` if both are present.
   */
  predicate?: unknown;
}

interface IfElseOutput {
  branch: 'true' | 'false';
  reason: string;
}

@Injectable()
export class IfElseExecutor
  implements NodeExecutor<unknown, IfElseOutput>
{
  readonly type = 'if-else' as const;

  async execute(
    _ctx: RunContext,
    config: Record<string, unknown>,
    input: unknown,
  ): Promise<NodeExecutorResult<IfElseOutput>> {
    const cfg = config as unknown as IfElseConfig;
    let branch: 'true' | 'false' = 'false';
    let reason = 'no predicate set; defaulted to false';

    if (cfg.simple) {
      const value = readPath(input, cfg.simple.path);
      branch = applyOp(cfg.simple.op, value, cfg.simple.value) ? 'true' : 'false';
      reason = `simple ${cfg.simple.op} on ${cfg.simple.path} -> ${branch}`;
    } else if (cfg.predicate !== undefined) {
      branch = evaluateJsonLogic(cfg.predicate, input) ? 'true' : 'false';
      reason = `predicate -> ${branch}`;
    }

    return {
      output: { branch, reason },
      preferredBranchLabel: branch,
      traceMeta: { branch, reason },
    };
  }
}

function readPath(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  const parts = path.split('.');
  let cursor: unknown = obj;
  for (const part of parts) {
    if (cursor && typeof cursor === 'object' && part in (cursor as object)) {
      cursor = (cursor as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cursor;
}

function applyOp(
  op: NonNullable<IfElseConfig['simple']>['op'],
  left: unknown,
  right: unknown,
): boolean {
  switch (op) {
    case 'eq':
      return left === right;
    case 'neq':
      return left !== right;
    case 'gt':
      return Number(left) > Number(right);
    case 'gte':
      return Number(left) >= Number(right);
    case 'lt':
      return Number(left) < Number(right);
    case 'lte':
      return Number(left) <= Number(right);
    case 'truthy':
      return Boolean(left);
    default:
      return false;
  }
}

/**
 * Minimal JSONLogic subset — enough for the canvas's default predicates.
 * Supported ops: `>`, `>=`, `<`, `<=`, `==`, `!=`, `and`, `or`, `var`.
 */
function evaluateJsonLogic(rule: unknown, data: unknown): boolean {
  if (rule == null) return false;
  if (typeof rule !== 'object') return Boolean(rule);
  const entries = Object.entries(rule as Record<string, unknown>);
  if (entries.length !== 1) return false;
  const [op, args] = entries[0];
  const argList = Array.isArray(args) ? args : [args];
  const resolved = argList.map((a) => evaluateValue(a, data));
  switch (op) {
    case '>':
      return Number(resolved[0]) > Number(resolved[1]);
    case '>=':
      return Number(resolved[0]) >= Number(resolved[1]);
    case '<':
      return Number(resolved[0]) < Number(resolved[1]);
    case '<=':
      return Number(resolved[0]) <= Number(resolved[1]);
    case '==':
      // eslint-disable-next-line eqeqeq
      return resolved[0] == resolved[1];
    case '!=':
      // eslint-disable-next-line eqeqeq
      return resolved[0] != resolved[1];
    case 'and':
      return resolved.every(Boolean);
    case 'or':
      return resolved.some(Boolean);
    default:
      return false;
  }
}

function evaluateValue(arg: unknown, data: unknown): unknown {
  if (arg && typeof arg === 'object' && 'var' in (arg as object)) {
    const path = String((arg as { var: unknown }).var ?? '');
    return readPath(data, path);
  }
  if (
    arg &&
    typeof arg === 'object' &&
    Object.keys(arg as object).length === 1
  ) {
    return evaluateJsonLogic(arg, data);
  }
  return arg;
}
