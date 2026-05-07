/**
 * Facade for pipeline stages that need to load document metadata or process
 * uploaded attachments. Wraps:
 *
 *  - `documentModel` queries (with explicit userId filter for tenant safety)
 *  - `AttachmentProcessor` (the existing chat util that extracts content
 *    from uploaded files / Google Drive links / etc.)
 *
 * Eventually replaces the equivalent private methods on `ChatService`
 * (`fetchDocumentMetadata`, `mapAttachmentsToInput`). Until that's done,
 * `processChatRequest` reads results from the pipeline context when
 * AttachmentStage already ran.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Document as DocSchema } from '../../../../schemas/document/document.schema';
import {
  AttachmentProcessor,
  type AttachmentInput,
  type ProcessedAttachment,
} from '../../utils/attachment-processor';
import { generateSecureId } from '../../../../common/utils/secure-id.util';
import type { SendMessageDto } from '../../dto/send-message.dto';

interface ProcessedAttachmentResult {
  processed: ProcessedAttachment[];
  contextText: string;
}

@Injectable()
export class AttachmentResolver {
  private readonly logger = new Logger(AttachmentResolver.name);

  constructor(
    @InjectModel(DocSchema.name)
    private readonly documentModel: Model<DocSchema>,
    private readonly attachmentProcessor: AttachmentProcessor,
  ) {}

  /**
   * Fetch metadata for attached documentIds, scoped to the requesting user.
   *
   * Why explicit `userId` filter: defence-in-depth on top of any retrieval-
   * service scoping. A leak here would let one user pull another's docs.
   */
  async fetchDocumentMetadata(
    documentIds: string[],
    userId: string,
  ): Promise<any[]> {
    if (!documentIds || documentIds.length === 0) return [];
    const objectIds = documentIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (objectIds.length === 0) return [];
    return this.documentModel
      .find({ _id: { $in: objectIds }, userId })
      .lean();
  }

  /**
   * Process uploaded attachments — extracts file content (text from PDFs,
   * sheets, Google Drive docs, etc.) and returns:
   *  - `processed`: attachments enriched with `extractedContent` (passed
   *    along to the model so it can read what's inside)
   *  - `contextText`: a flat string concatenation suitable for prompt
   *    augmentation when the handler doesn't pass attachments through
   *
   * Mirrors `ChatService.sendMessage`'s legacy block (lines ~717-729).
   */
  async processAttachments(
    attachments: SendMessageDto['attachments'],
    userId: string,
  ): Promise<ProcessedAttachmentResult> {
    if (!attachments || attachments.length === 0) {
      return { processed: [], contextText: '' };
    }
    const inputs = this.mapToAttachmentInputs(attachments);
    const result = await this.attachmentProcessor.processAttachments(
      inputs,
      userId,
    );
    return {
      processed: result.processedAttachments,
      contextText: result.contextString ?? '',
    };
  }

  /**
   * Translate the controller-shaped DTO into the AttachmentProcessor's
   * `AttachmentInput[]`. Logic copied verbatim from the legacy
   * `ChatService.mapAttachmentsToInput` so behaviour is identical.
   */
  private mapToAttachmentInputs(
    attachments: NonNullable<SendMessageDto['attachments']>,
  ): AttachmentInput[] {
    return attachments.map((a) => {
      const type = a.type === 'google' ? 'google' : 'uploaded';
      const url = a.url || '';
      const fileId =
        url ||
        (a as any).fileId ||
        generateSecureId('att').replace('_', '-');
      return {
        type,
        fileId,
        fileName: a.name,
        fileSize: a.size ?? 0,
        mimeType: a.mimeType ?? 'application/octet-stream',
        fileType: a.mimeType?.split('/')[0] ?? 'file',
        url,
        ...(type === 'google' &&
          (a as any).googleFileId && { googleFileId: (a as any).googleFileId }),
        ...(type === 'google' &&
          (a as any).connectionId && { connectionId: (a as any).connectionId }),
      };
    });
  }
}
