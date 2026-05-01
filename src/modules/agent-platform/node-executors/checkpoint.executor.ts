import { Injectable, Logger } from '@nestjs/common';
import {
  NodeExecutor,
  NodeExecutorResult,
  RunContext,
} from './base-node-executor';

interface CheckpointConfig {
  reason?: string;
  notify?: {
    slackChannel?: string;
    email?: string;
  };
  timeoutSeconds?: number;
}

interface CheckpointOutput {
  paused: true;
  reason: string;
  upstream: unknown;
}

/**
 * Pauses the run. The runner watches for `result.pause` and stops walking;
 * a separate `POST /runs/:runId/resume` call carries the human's decision
 * and resumes from this node onward.
 *
 * v1: notify channels are recorded on the trace step but not actually
 * dispatched to Slack/email. Wiring real notification delivery is a v1.1
 * follow-up — the trace already shows the pending checkpoint.
 */
@Injectable()
export class CheckpointExecutor
  implements NodeExecutor<unknown, CheckpointOutput>
{
  private readonly logger = new Logger(CheckpointExecutor.name);
  readonly type = 'checkpoint' as const;

  async execute(
    ctx: RunContext,
    config: Record<string, unknown>,
    input: unknown,
  ): Promise<NodeExecutorResult<CheckpointOutput>> {
    const cfg = config as unknown as CheckpointConfig;
    const reason = cfg?.reason ?? 'human approval required';

    if (cfg?.notify?.slackChannel || cfg?.notify?.email) {
      this.logger.log(
        `Checkpoint notification queued (run=${ctx.runId}): ${JSON.stringify(
          cfg.notify,
        )}`,
      );
    }

    return {
      output: {
        paused: true,
        reason,
        upstream: input,
      },
      pause: {
        reason,
        payload: input,
      },
      traceMeta: {
        notify: cfg?.notify ?? null,
        timeoutSeconds: cfg?.timeoutSeconds ?? null,
      },
    };
  }
}
