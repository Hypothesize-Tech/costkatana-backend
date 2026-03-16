/**
 * Ingestion Controller
 * Handles document ingestion endpoints with progress tracking and SSE
 */

import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
  NotFoundException,
  Sse,
  MessageEvent,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Observable, fromEvent, map } from 'rxjs';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IngestionService, UploadProgress } from './services/ingestion.service';
import type { ProcessedDocument } from './services/document-processor.service';

@Controller('api/ingestion')
@UseGuards(JwtAuthGuard)
export class IngestionController {
  private readonly logger = new Logger(IngestionController.name);

  constructor(
    private readonly ingestionService: IngestionService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Trigger manual ingestion (admin only)
   */
  @Post('trigger')
  async triggerIngestion(
    @Body() body: { type?: string; userId?: string; since?: string },
    @CurrentUser() user: any,
  ) {
    const { type, userId, since } = body;

    switch (type) {
      case 'knowledge-base':
        const kbResult = await this.ingestionService.ingestKnowledgeBase();
        return {
          success: kbResult.success,
          data: {
            documentsIngested: kbResult.documentsIngested,
            duration: kbResult.duration,
            errors: kbResult.errors,
          },
        };

      case 'conversations':
        const convResult = await this.ingestionService.ingestConversations(
          userId,
          since ? new Date(since) : undefined,
        );
        return {
          success: convResult.success,
          data: {
            documentsIngested: convResult.documentsIngested,
            duration: convResult.duration,
            errors: convResult.errors,
          },
        };

      case 'telemetry':
        const telResult = await this.ingestionService.ingestTelemetry(
          userId,
          since ? new Date(since) : undefined,
        );
        return {
          success: telResult.success,
          data: {
            documentsIngested: telResult.documentsIngested,
            duration: telResult.duration,
            errors: telResult.errors,
          },
        };

      default:
        throw new BadRequestException(
          'Invalid ingestion type. Allowed: knowledge-base, conversations, telemetry',
        );
    }
  }

  /**
   * Upload custom document (with S3 storage and progress tracking)
   */
  @Post('upload')
  async uploadDocument(
    @Body()
    body: {
      fileName?: string;
      fileData?: string;
      mimeType?: string;
      projectId?: string;
      tags?: string;
      description?: string;
    },
    @CurrentUser() user: any,
  ) {
    const { fileName, fileData, mimeType, projectId, tags, description } = body;
    const userId = user.id || user._id || user.userId;

    if (!fileName || !fileData) {
      throw new BadRequestException('fileName and fileData are required');
    }

    // Decode base64 file data
    let fileBuffer: Buffer;
    try {
      fileBuffer = Buffer.from(fileData, 'base64');
    } catch (error) {
      throw new BadRequestException(
        'Invalid file data format. Expected base64 encoded string.',
      );
    }

    this.logger.log(`Document upload initiated`, {
      userId,
      fileName,
      fileSize: fileBuffer.length,
    });

    // Generate upload ID for progress tracking
    const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Generate (predictable) documentId, save in DB during ingestion
    const documentId = `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Start background processing ASYNCHRONOUSLY (don't await!)
    this.ingestionService
      .ingestFileBuffer(
        fileBuffer,
        fileName,
        userId,
        {
          documentId,
          projectId: projectId || undefined,
          tags: tags
            ? tags
                .split(',')
                .map((t: string) => t.trim())
                .filter(Boolean)
            : [],
          mimeType: mimeType,
          customMetadata: {
            description: description?.trim() || '',
            uploadedAt: new Date(),
          },
        } as Partial<ProcessedDocument['metadata']>,
        uploadId,
      )
      .then((ingestionResult) => {
        if (ingestionResult.success) {
          this.logger.log(
            'Document ingestion completed successfully (background)',
            {
              documentId: ingestionResult.documentId,
              uploadId,
              fileName,
              chunksCreated: ingestionResult.documentsIngested,
              duration: ingestionResult.duration,
            },
          );
        } else {
          this.logger.error('Document ingestion failed (background)', {
            documentId: ingestionResult.documentId,
            fileName,
            errors: ingestionResult.errors,
          });
        }
      })
      .catch((error) => {
        this.logger.error('Document ingestion crashed (background)', {
          uploadId,
          fileName,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    // Return response IMMEDIATELY with uploadId for SSE tracking
    this.logger.log('Document upload initiated, processing in background', {
      documentId,
      uploadId,
      fileName,
    });

    return {
      success: true,
      message: 'Document uploaded successfully, processing in background',
      data: {
        documentId,
        uploadId,
        fileName,
        status: 'processing',
      },
    };
  }

  /**
   * SSE endpoint for upload progress tracking
   */
  @Sse('upload-progress/:uploadId')
  getUploadProgress(
    @Param('uploadId') uploadId: string,
  ): Observable<MessageEvent> {
    if (!uploadId) {
      throw new BadRequestException('uploadId is required');
    }

    this.logger.log('SSE connection established for upload progress', {
      uploadId,
    });

    return fromEvent(this.eventEmitter, `progress:${uploadId}`).pipe(
      map((progress: UploadProgress) => ({
        data: JSON.stringify(progress),
      })),
    );
  }

  /**
   * Get ingestion job status by jobId
   */
  @Get('status/:jobId')
  async getJobStatus(@Param('jobId') jobId: string) {
    if (!jobId) {
      throw new BadRequestException('jobId is required');
    }

    const job = await this.ingestionService.getJobStatus(jobId);

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    return {
      success: true,
      data: job,
    };
  }

  /**
   * Get ingestion statistics for the current user
   */
  @Get('stats')
  async getStats(@CurrentUser() user: any) {
    const userId = user.id || user._id || user.userId;

    const stats = await this.ingestionService.getStats(userId);

    return {
      success: true,
      data: stats,
    };
  }

  /**
   * List user's uploaded documents
   */
  @Get('documents')
  async listDocuments(
    @Query() query: { limit?: string; skip?: string; source?: string },
    @CurrentUser() user: any,
  ) {
    const userId = user.id || user._id || user.userId;
    const defaultLimit = 20;
    const defaultSkip = 0;
    const {
      limit = `${defaultLimit}`,
      skip = `${defaultSkip}`,
      source,
    } = query;

    const parsedLimit = Math.max(
      1,
      Math.min(100, parseInt(limit, 10) || defaultLimit),
    );
    const parsedSkip = Math.max(0, parseInt(skip, 10) || defaultSkip);

    // Query user's uploaded documents from ingestionService
    const { documents, total } = await this.ingestionService.listUserDocuments(
      userId,
      {
        limit: parsedLimit,
        skip: parsedSkip,
        source: source || undefined,
      },
    );

    return {
      success: true,
      data: {
        documents,
        total,
        limit: parsedLimit,
        skip: parsedSkip,
      },
    };
  }

  /**
   * Get user's uploaded documents with metadata (for chat)
   */
  @Get('user-documents')
  async getUserDocuments(@CurrentUser() user: any) {
    const userId = user.id || user._id || user.userId;
    const documents =
      await this.ingestionService.listUserDocumentsMetadata(userId);

    return {
      success: true,
      data: documents,
    };
  }

  /**
   * Get a document preview (first N chunks/pages)
   */
  @Get('documents/:documentId/preview')
  async getDocumentPreview(
    @Param('documentId') documentId: string,
    @Query('maxChunks') maxChunks: string,
    @CurrentUser() user: any,
  ) {
    const userId = user.id || user._id || user.userId;
    const max = Math.max(
      1,
      Math.min(maxChunks ? parseInt(maxChunks, 10) : 3, 30),
    );

    // Query document chunks and combine them for the preview
    const documentPreview = await this.ingestionService.getDocumentPreview(
      documentId,
      userId,
      max,
    );

    if (!documentPreview) {
      throw new NotFoundException('Document not found or access denied');
    }

    return {
      success: true,
      data: documentPreview,
    };
  }

  /**
   * Delete document (only if owned by the current user or admin)
   */
  @Delete('documents/:id')
  async deleteDocument(
    @Param('id') documentId: string,
    @CurrentUser() user: any,
  ) {
    const userId = user.id || user._id || user.userId;

    const success = await this.ingestionService.deleteDocument(
      documentId,
      userId,
    );

    if (!success) {
      throw new NotFoundException('Document not found or access denied');
    }

    return {
      success: true,
      message: 'Document deleted successfully',
    };
  }

  /**
   * Reindex all documents (admin only)
   */
  @Post('reindex')
  async reindexAll(@CurrentUser() user: any) {
    if (!user.isAdmin && !user.roles?.includes('admin')) {
      throw new ForbiddenException('Only admins can reindex');
    }

    const results = await Promise.allSettled([
      this.ingestionService.ingestKnowledgeBase(),
      this.ingestionService.ingestConversations(),
      this.ingestionService.ingestTelemetry(),
    ]);

    const summary = results.map((result, index) => {
      const type = ['knowledge-base', 'conversations', 'telemetry'][index];
      if (result.status === 'fulfilled') {
        return {
          type,
          success: result.value.success,
          documentsIngested: result.value.documentsIngested,
          duration: result.value.duration,
          errors: result.value.errors ?? [],
        };
      } else {
        this.logger.error(`Reindex ${type} failed`, { error: result.reason });
        return {
          type,
          success: false,
          error:
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
        };
      }
    });

    return {
      success: true,
      message: 'Reindex completed',
      data: summary,
    };
  }
}
