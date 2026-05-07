/**
 * SecurityStage
 *
 * First stage. Runs the threat-detection / prompt-injection / rate-limit
 * checks via `ChatSecurityHandlerService`. Pure read; no rollback needed.
 *
 * Note: the controller (`chat.controller.ts:165`) ALSO performs this check
 * before calling `sendMessage`. That's defence-in-depth; we still run it
 * here so a non-controller caller (queue worker, internal job, etc.) gets
 * the same protection.
 */
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ChatSecurityHandlerService } from '../../../analytics/services/chat-security-handler.service';
import type { PipelineStage, StageResult } from '../types/stage-result';
import { ok, fail } from '../types/stage-result';
import type { StageContext } from '../types/stage-context';

@Injectable()
export class SecurityStage implements PipelineStage {
  readonly name = 'security';
  private readonly logger = new Logger(SecurityStage.name);

  constructor(
    private readonly chatSecurityHandler: ChatSecurityHandlerService,
  ) {}

  async run(ctx: StageContext): Promise<StageResult> {
    const message = ctx.dto.message?.trim();
    if (!message) {
      // Validation belongs here too — sendMessage requires *one of* message,
      // templateId, or attachments. An empty message without those is invalid.
      const hasTemplate =
        !!ctx.dto.templateId && ctx.dto.templateId.length > 0;
      const hasAttachments =
        !!ctx.dto.attachments && ctx.dto.attachments.length > 0;
      if (!hasTemplate && !hasAttachments) {
        return fail(
          this.name,
          'empty_input',
          'At least one of message, templateId, or attachments is required.',
        );
      }
      // No message body to scan; still record the original.
      return ok({ originalMessage: '', effectiveMessage: '' });
    }

    try {
      const result = await this.chatSecurityHandler.checkMessageSecurity(
        message,
        ctx.userId,
        ctx.req as any,
        ctx.dto.maxTokens || 8000,
      );
      if (result.isBlocked) {
        // Surface as HTTP 4xx to controller — security blocks are user-facing,
        // not pipeline failures we can recover from.
        throw new HttpException(
          {
            success: false,
            message: result.reason || 'Message blocked by security system',
            error: 'SECURITY_BLOCK',
            threatCategory: result.threatCategory,
            confidence: result.confidence,
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      return ok({
        originalMessage: ctx.dto.originalMessage || message,
        effectiveMessage: message,
      });
    } catch (err) {
      // HttpException flows up to the controller as-is.
      if (err instanceof HttpException) throw err;
      this.logger.warn('Security check failed unexpectedly', {
        requestId: ctx.requestId,
        error: err instanceof Error ? err.message : String(err),
      });
      // Fail-CLOSED on unknown security check error — never let an unchecked
      // message reach the LLM.
      return fail(
        this.name,
        'security_check_error',
        'Security check failed; refusing to proceed.',
        err,
      );
    }
  }
}
