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
  /**
   * Message to surface in the chat widget when this checkpoint auto-skips
   * because there's no human in the loop. Falls back to a generic line if
   * not configured.
   */
  widgetFallbackMessage?: string;
}

interface CheckpointOutput {
  paused: boolean;
  reason: string;
  upstream: unknown;
  /**
   * Set on the auto-skip path so the chat widget (which reads `output.text`)
   * has something to display. Omitted in the human-in-loop pause path.
   */
  text?: string;
}

const DEFAULT_WIDGET_FALLBACK =
  "I'm not sure how to help with that — could you rephrase your question, or ask me about something specific?";

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

    // Auto-skip the pause when running from an embedded chat widget — the
    // end-user has no UI to approve a checkpoint, so pausing here would just
    // make the chat appear stuck. We still log/queue the notification so
    // operators see the event, but execution continues to the next node.
    //
    // We also surface a `text` field on the output so widgets that terminate
    // their DAG at this checkpoint (rather than routing to an LLM after) have
    // something readable to render. If the upstream node already produced a
    // text response, prefer that; otherwise fall back to the configured
    // widget message.
    if (ctx.widgetSessionId) {
      this.logger.log(
        `Checkpoint auto-passed for widget session (run=${ctx.runId}, session=${ctx.widgetSessionId}) — no human-in-the-loop in chat mode.`,
      );
      const upstreamText =
        input && typeof input === 'object' && 'text' in (input as object)
          ? (input as { text?: unknown }).text
          : undefined;
      const text =
        typeof upstreamText === 'string' && upstreamText.trim().length > 0
          ? upstreamText
          : cfg?.widgetFallbackMessage ?? DEFAULT_WIDGET_FALLBACK;

      return {
        output: {
          paused: false,
          reason,
          upstream: input,
          text,
        },
        traceMeta: {
          notify: cfg?.notify ?? null,
          timeoutSeconds: cfg?.timeoutSeconds ?? null,
          autoSkipped: 'widget_session',
        },
      };
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
