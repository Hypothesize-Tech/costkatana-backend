import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { User } from '../../../schemas/user/user.schema';
import { EmailService } from '../../email/email.service';
import { WebhookEventEmitterService } from '../../webhook/webhook-event-emitter.service';
import { WEBHOOK_EVENTS } from '../../webhook/webhook.types';
import { TopActionService } from './top-action.service';
import { SlackNotifierService } from './slack-notifier.service';
import type { DecisionContext } from '../types/decision-context';

const DIGEST_TOP_N = 3;

@Injectable()
export class DecisionDigestService {
  private readonly logger = new Logger(DecisionDigestService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly topActionService: TopActionService,
    private readonly emailService: EmailService,
    private readonly webhookEventEmitter: WebhookEventEmitterService,
    private readonly slackNotifier: SlackNotifierService,
  ) {}

  /**
   * Run once per day at 08:00 UTC. Each user with at least one urgent or
   * weekly decision gets an email + webhook event with the top 3 framed
   * decisions. Slack delivery piggybacks on the same webhook contract.
   */
  @Cron('0 8 * * *')
  async runDailyDigest(): Promise<void> {
    this.logger.log('Running daily decision digest');

    const users = await this.userModel
      .find({ isDeleted: { $ne: true } }, { _id: 1, email: 1 })
      .lean()
      .exec();

    let sent = 0;
    for (const user of users) {
      try {
        const decisions = await this.topActionService.list(
          String(user._id),
          { state: 'action_required', limit: DIGEST_TOP_N },
        );
        if (decisions.length === 0) continue;
        const hasActionable = decisions.some(
          (d) => d.urgency === 'now' || d.urgency === 'this_week',
        );
        if (!hasActionable) continue;

        if (user.email) {
          await this.sendDigestEmail(user.email, decisions);
        }
        await this.emitWebhook(String(user._id), decisions);
        await this.slackNotifier.notify(String(user._id), decisions);
        sent += 1;
      } catch (error) {
        this.logger.warn('Decision digest failed for user', {
          userId: String(user._id),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.log(`Daily decision digest sent to ${sent} user(s)`);
  }

  private async sendDigestEmail(
    to: string,
    decisions: DecisionContext[],
  ): Promise<void> {
    const cards = decisions
      .map(
        (d) => `
          <div style="border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; margin: 12px 0; background: #ffffff;">
            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: ${
              d.urgency === 'now' ? '#dc2626' : '#d97706'
            }; font-weight: 700;">${this.urgencyLabel(d.urgency)}</div>
            <div style="font-size: 16px; font-weight: 700; margin: 6px 0; color: #111827;">${this.escapeHtml(
              d.headline,
            )}</div>
            <div style="font-size: 13px; color: #4b5563; font-style: italic; margin-bottom: 10px;">${this.escapeHtml(
              d.narrative,
            )}</div>
            <div style="font-size: 14px; font-weight: 600; color: #059669;">
              $${d.impact.amountUsd.toFixed(2)}${this.tfSuffix(d.impact.timeframe)}
            </div>
          </div>
        `,
      )
      .join('');

    const html = `
      <!DOCTYPE html>
      <html>
        <head><meta charset="utf-8" /></head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background: #f9fafb; padding: 24px; color: #111827;">
          <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
            <h1 style="font-size: 22px; margin: 0 0 6px 0;">Your cost decisions today</h1>
            <p style="color: #6b7280; font-size: 14px; margin: 0 0 20px 0;">These are the ${decisions.length} highest-impact decisions worth your attention. Acting now recovers meaningful spend.</p>
            ${cards}
            <p style="color: #6b7280; font-size: 12px; margin-top: 24px;">Open CostKatana to apply or dismiss. You can change digest frequency in Settings → Notifications.</p>
          </div>
        </body>
      </html>
    `;

    await this.emailService.sendEmail({
      to,
      subject: `CostKatana — ${decisions.length} decision${
        decisions.length === 1 ? '' : 's'
      } worth your attention`,
      html,
    });
  }

  private async emitWebhook(
    userId: string,
    decisions: DecisionContext[],
  ): Promise<void> {
    try {
      const top = decisions[0];
      await this.webhookEventEmitter.emitCostAlert(userId, undefined, {
        title: top.headline,
        description: top.narrative,
        severity: top.urgency === 'now' ? 'high' : 'medium',
        cost: {
          amount: top.impact.amountUsd,
          currency: 'USD',
          period: top.impact.timeframe.replace('per_', '') as
            | 'day'
            | 'week'
            | 'month',
        },
      });
    } catch (error) {
      this.logger.warn('Digest webhook emit failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private urgencyLabel(u: string): string {
    if (u === 'now') return 'Act now';
    if (u === 'this_week') return 'This week';
    if (u === 'this_month') return 'This month';
    return 'FYI';
  }

  private tfSuffix(tf: string): string {
    if (tf === 'per_day') return '/day';
    if (tf === 'per_week') return '/week';
    return '/month';
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

// Expose WEBHOOK_EVENTS so tree-shaking doesn't drop the import
void WEBHOOK_EVENTS;
