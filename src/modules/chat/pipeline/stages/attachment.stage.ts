/**
 * AttachmentStage
 *
 * Resolves attached documents (`dto.documentIds`) and uploaded attachments
 * (`dto.attachments`) into:
 *  - `ctx.attachedDocuments` — metadata fetched from the storage layer.
 *  - `ctx.attachmentContext` — text representation appended to the prompt.
 *  - `ctx.attachments` — sanitised attachment refs.
 *
 * Behaviour mirrors the early-attachment block in `ChatService.sendMessage`
 * (~lines 548-614) but in a unit-testable form. Heavy lifting still lives
 * in the existing `attachment-processor` util + `fetchDocumentMetadata`.
 *
 * Failure mode: attachment-processing failures are non-fatal in the legacy
 * flow ("Continue without document metadata - not a critical failure").
 * We preserve that — return `ok` even on partial failure, but log.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { PipelineStage, StageResult } from '../types/stage-result';
import { ok } from '../types/stage-result';
import type { StageContext } from '../types/stage-context';
import { AttachmentResolver } from '../helpers/attachment-resolver.service';

@Injectable()
export class AttachmentStage implements PipelineStage {
  readonly name = 'attachment';
  private readonly logger = new Logger(AttachmentStage.name);

  constructor(private readonly attachmentResolver: AttachmentResolver) {}

  async run(ctx: StageContext): Promise<StageResult> {
    const dto = ctx.dto;

    let attachedDocuments: any[] = [];
    if (dto.documentIds && dto.documentIds.length > 0) {
      try {
        attachedDocuments = await this.attachmentResolver.fetchDocumentMetadata(
          dto.documentIds,
          ctx.userId,
        );
      } catch (err) {
        this.logger.warn('Failed to fetch document metadata; continuing', {
          requestId: ctx.requestId,
          documentIds: dto.documentIds,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    let processedAttachments: any[] = [];
    let attachmentContext = '';
    if (dto.attachments && dto.attachments.length > 0) {
      try {
        const result = await this.attachmentResolver.processAttachments(
          dto.attachments,
          ctx.userId,
        );
        processedAttachments = result.processed;
        attachmentContext = result.contextText ?? '';
      } catch (err) {
        this.logger.warn('Failed to process attachments; continuing', {
          requestId: ctx.requestId,
          count: dto.attachments.length,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return ok({
      attachedDocuments,
      attachments: processedAttachments,
      attachmentContext,
    });
  }
}
