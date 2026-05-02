import { Injectable } from '@nestjs/common';
import {
  NodeExecutor,
  NodeExecutorResult,
  RunContext,
} from './base-node-executor';

interface UserMessageOutput {
  message: string;
  metadata?: Record<string, unknown>;
}

/**
 * Reads the run input and surfaces it to downstream nodes as `{ message }`.
 * Accepts either a raw string or `{ message, metadata }` shape on the run
 * input — normalizing here keeps the rest of the DAG simple.
 */
@Injectable()
export class UserMessageInputExecutor
  implements NodeExecutor<unknown, UserMessageOutput>
{
  readonly type = 'user-message-input' as const;

  async execute(
    ctx: RunContext,
    _config: Record<string, unknown>,
    _input: unknown,
  ): Promise<NodeExecutorResult<UserMessageOutput>> {
    const raw = ctx.runInput;
    let output: UserMessageOutput;

    if (typeof raw === 'string') {
      output = { message: raw };
    } else if (raw && typeof raw === 'object' && 'message' in (raw as object)) {
      const obj = raw as { message: unknown; metadata?: unknown };
      output = {
        message: typeof obj.message === 'string' ? obj.message : String(obj.message),
        metadata:
          obj.metadata && typeof obj.metadata === 'object'
            ? (obj.metadata as Record<string, unknown>)
            : undefined,
      };
    } else {
      output = { message: '' };
    }

    return { output };
  }
}
