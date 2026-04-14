import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../../../schemas/user/user.schema';
import type { DecisionContext } from '../types/decision-context';

/**
 * Minimal Slack integration via incoming-webhook URL.
 *
 * We deliberately start with the simplest-workable channel: a user saves a
 * Slack incoming-webhook URL in their preferences, and we POST a Block Kit
 * message when the daily digest fires or a "now"-urgency decision appears.
 *
 * OAuth app + bot-token channel-per-user routing is the next step; this
 * service exposes `notify(userId, decisions)` as the stable contract so the
 * digest flow doesn't need to change when we upgrade to OAuth.
 */
@Injectable()
export class SlackNotifierService {
  private readonly logger = new Logger(SlackNotifierService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  async notify(
    userId: string,
    decisions: DecisionContext[],
  ): Promise<{ delivered: boolean }> {
    if (decisions.length === 0) return { delivered: false };

    const user = await this.userModel
      .findById(userId, { 'preferences.integrations.slackWebhookUrl': 1 })
      .lean()
      .exec();
    const url = (user as any)?.preferences?.integrations?.slackWebhookUrl as
      | string
      | undefined;
    if (!url) return { delivered: false };

    const blocks = this.buildBlocks(decisions);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: decisions[0].headline,
          blocks,
        }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        this.logger.warn('Slack webhook non-2xx', {
          userId,
          status: response.status,
          body: body.slice(0, 300),
        });
        return { delivered: false };
      }
      return { delivered: true };
    } catch (error) {
      this.logger.warn('Slack webhook delivery failed', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { delivered: false };
    }
  }

  private buildBlocks(decisions: DecisionContext[]): Array<Record<string, unknown>> {
    const header = {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'CostKatana — decisions worth your attention',
        emoji: true,
      },
    };

    const items = decisions.slice(0, 3).flatMap((d) => [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${this.urgencyPrefix(d.urgency)}  ${this.escape(d.headline)}*\n_${this.escape(d.narrative)}_`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `💸 *$${d.impact.amountUsd.toFixed(2)}${this.tfSuffix(
              d.impact.timeframe,
            )}*  ·  ${Math.round(d.impact.confidence * 100)}% confidence`,
          },
        ],
      },
      { type: 'divider' },
    ]);

    return [header, ...items];
  }

  private urgencyPrefix(u: string): string {
    if (u === 'now') return '🔴 Now';
    if (u === 'this_week') return '🟠 This week';
    if (u === 'this_month') return '🟡 This month';
    return '🟢 FYI';
  }

  private tfSuffix(tf: string): string {
    if (tf === 'per_day') return '/day';
    if (tf === 'per_week') return '/week';
    return '/month';
  }

  private escape(s: string): string {
    return s.replace(/[<>&]/g, (c) =>
      c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;',
    );
  }
}
