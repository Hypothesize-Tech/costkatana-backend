import { Injectable } from '@nestjs/common';
import {
  NodeExecutor,
  NodeExecutorResult,
  RunContext,
} from './base-node-executor';

interface ResponseInput {
  text?: string;
  citations?: unknown[];
  /** Anything else passed in from upstream that the response should bundle. */
  [key: string]: unknown;
}

interface ResponseOutput {
  text: string;
  citations: unknown[];
  raw: ResponseInput;
}

/**
 * Terminal node — collects the upstream payload and finalizes the run's
 * `output`. The runner reads the last response-output's value and writes
 * it onto the AgentRun document.
 *
 * Optional `template` config (Mustache-light: `{{key}}`) lets template
 * authors interpolate input fields into a final reply string. Empty
 * template falls through to the upstream `text` field.
 */
@Injectable()
export class ResponseOutputExecutor
  implements NodeExecutor<ResponseInput, ResponseOutput>
{
  readonly type = 'response-output' as const;

  async execute(
    _ctx: RunContext,
    config: Record<string, unknown>,
    input: ResponseInput,
  ): Promise<NodeExecutorResult<ResponseOutput>> {
    const template = typeof config?.template === 'string' ? config.template : '';
    let text: string;
    if (template.length > 0) {
      text = template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key) => {
        const value = readPath(input, String(key));
        return value === undefined ? '' : String(value);
      });
    } else {
      text =
        typeof input?.text === 'string'
          ? input.text
          : input
            ? JSON.stringify(input)
            : '';
    }

    return {
      output: {
        text,
        citations: Array.isArray(input?.citations) ? input.citations : [],
        raw: input ?? {},
      },
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
