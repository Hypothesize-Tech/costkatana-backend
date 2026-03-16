/**
 * File Upload Service
 * Handles S3 upload, UploadedFile persistence, and ingestion for RAG.
 * Production implementation - no placeholders.
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  UploadedFile,
  UploadedFileDocument,
} from '../../schemas/misc/uploaded-file.schema';
import {
  ChatMessage,
  ChatMessageDocument,
} from '../../schemas/chat/chat-message.schema';
import { StorageService } from '../storage/storage.service';
import { IngestionService } from '../ingestion/services/ingestion.service';

const PRESIGNED_URL_EXPIRY_SECONDS = 3600;
const USER_FILES_LIMIT = 50;
const ALL_FILES_UPLOAD_LIMIT = 100;
const ALL_FILES_MESSAGES_LIMIT = 500;

export interface UploadFileResult {
  fileId: string;
  documentId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  fileType: string;
  url: string;
  uploadedAt: Date;
  ingested: boolean;
  chunksCreated?: number;
  ingestionError?: string;
}

export interface UserFileItem {
  fileId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  fileType: string;
  uploadedAt: Date;
  hasExtractedText: boolean;
  url: string;
  conversationId?: string;
}

export interface AllFilesItem {
  id: string;
  name: string;
  size: number;
  type: 'uploaded' | 'google' | 'document';
  mimeType?: string;
  fileType?: string;
  url?: string;
  uploadedAt: Date;
  source: string;
  conversationId?: string;
  chunksCount?: number;
  documentId?: string;
}

@Injectable()
export class FileUploadService {
  private readonly logger = new Logger(FileUploadService.name);

  constructor(
    @InjectModel(UploadedFile.name)
    private readonly uploadedFileModel: Model<UploadedFileDocument>,
    @InjectModel(ChatMessage.name)
    private readonly chatMessageModel: Model<ChatMessageDocument>,
    private readonly storageService: StorageService,
    private readonly ingestionService: IngestionService,
  ) {}

  /**
   * Upload a file: S3, DB record, then ingest for RAG.
   */
  async uploadFile(
    userId: string,
    buffer: Buffer,
    originalname: string,
    mimetype: string,
    size: number,
  ): Promise<UploadFileResult> {
    const fileType = originalname.split('.').pop()?.toLowerCase() || 'unknown';
    const documentId = `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const userIdStr = typeof userId === 'string' ? userId : String(userId);

    const { s3Key, presignedUrl } = await this.storageService.uploadChatFile(
      userIdStr,
      originalname,
      buffer,
      mimetype,
    );

    const uploadedFile = new this.uploadedFileModel({
      userId: new Types.ObjectId(userIdStr),
      fileName: originalname,
      originalName: originalname,
      fileSize: size,
      mimeType: mimetype,
      s3Key,
      fileType,
      uploadedAt: new Date(),
    });
    await uploadedFile.save();

    this.logger.log('File uploaded to S3 and database', {
      fileId: uploadedFile._id,
      fileName: originalname,
      fileType,
      fileSize: size,
      userId: userIdStr,
      documentId,
    });

    try {
      this.logger.log('Starting file ingestion for RAG search', {
        documentId,
        fileName: originalname,
        userId: userIdStr,
      });

      const ingestionResult = await this.ingestionService.ingestFileBuffer(
        buffer,
        originalname,
        userIdStr,
        {
          documentId,
          source: 'user-upload',
          fileName: originalname,
          fileType,
          fileSize: size,
          conversationId: undefined,
        },
      );

      this.logger.log('File ingestion completed', {
        fileId: uploadedFile._id,
        documentId,
        chunksCreated: ingestionResult.documentsIngested,
      });

      return {
        fileId: String(uploadedFile._id),
        documentId,
        fileName: originalname,
        fileSize: size,
        mimeType: mimetype,
        fileType,
        url: presignedUrl,
        uploadedAt: uploadedFile.uploadedAt,
        ingested: ingestionResult.success,
        chunksCreated: ingestionResult.documentsIngested,
      };
    } catch (ingestionError) {
      const errorMessage =
        ingestionError instanceof Error
          ? ingestionError.message
          : 'Unknown error';
      this.logger.warn('File ingestion failed (upload succeeded)', {
        fileId: uploadedFile._id,
        documentId,
        error: errorMessage,
      });
      return {
        fileId: String(uploadedFile._id),
        documentId,
        fileName: originalname,
        fileSize: size,
        mimeType: mimetype,
        fileType,
        url: presignedUrl,
        uploadedAt: uploadedFile.uploadedAt,
        ingested: false,
        ingestionError: errorMessage,
      };
    }
  }

  /**
   * Delete a file by id (S3 + DB). Must belong to userId.
   */
  async deleteFile(fileId: string, userId: string): Promise<void> {
    const userObjectId = new Types.ObjectId(userId);
    const file = await this.uploadedFileModel.findOne({
      _id: new Types.ObjectId(fileId),
      userId: userObjectId,
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    await this.storageService.deleteChatFile(file.s3Key);
    await this.uploadedFileModel.deleteOne({ _id: file._id });

    this.logger.log('File deleted', { fileId, userId });
  }

  /**
   * Get user's uploaded files only, with presigned URLs.
   */
  async getUserFiles(
    userId: string,
    conversationId?: string,
  ): Promise<UserFileItem[]> {
    const query: any = { userId: new Types.ObjectId(userId) };
    if (conversationId && Types.ObjectId.isValid(conversationId)) {
      query.conversationId = new Types.ObjectId(conversationId);
    }

    const files = await this.uploadedFileModel
      .find(query)
      .sort({ uploadedAt: -1 })
      .limit(USER_FILES_LIMIT)
      .lean()
      .exec();

    const filesWithUrls = await Promise.all(
      files.map(async (file) => {
        const url = await this.storageService.generatePresignedUrl(
          file.s3Key,
          PRESIGNED_URL_EXPIRY_SECONDS,
        );
        return {
          fileId: String(file._id),
          fileName: file.fileName,
          fileSize: file.fileSize,
          mimeType: file.mimeType,
          fileType: file.fileType,
          uploadedAt: file.uploadedAt,
          hasExtractedText: !!file.extractedText,
          url,
          conversationId: file.conversationId?.toString(),
        };
      }),
    );

    return filesWithUrls;
  }

  /**
   * Get ALL user's files: uploaded + Google Drive + documents from chat messages.
   */
  async getAllUserFiles(
    userId: string,
    conversationId?: string,
  ): Promise<AllFilesItem[]> {
    const allFiles: AllFilesItem[] = [];
    const userObjectId = new Types.ObjectId(userId);

    const uploadQuery: any = { userId: userObjectId };
    if (conversationId && Types.ObjectId.isValid(conversationId)) {
      uploadQuery.conversationId = new Types.ObjectId(conversationId);
    }

    const uploadedFiles = await this.uploadedFileModel
      .find(uploadQuery)
      .sort({ uploadedAt: -1 })
      .limit(ALL_FILES_UPLOAD_LIMIT)
      .lean()
      .exec();

    for (const file of uploadedFiles) {
      const url = await this.storageService.generatePresignedUrl(
        file.s3Key,
        PRESIGNED_URL_EXPIRY_SECONDS,
      );
      allFiles.push({
        id: String(file._id),
        name: file.fileName,
        size: file.fileSize,
        type: 'uploaded',
        mimeType: file.mimeType,
        fileType: file.fileType,
        url,
        uploadedAt: file.uploadedAt,
        source: 'Uploaded',
        conversationId: file.conversationId?.toString(),
      });
    }

    const messageQuery: any = { userId: String(userId) };
    if (conversationId && Types.ObjectId.isValid(conversationId)) {
      messageQuery.conversationId = new Types.ObjectId(conversationId);
    }

    const messages = await this.chatMessageModel
      .find(messageQuery)
      .select('attachments attachedDocuments conversationId createdAt')
      .sort({ createdAt: -1 })
      .limit(ALL_FILES_MESSAGES_LIMIT)
      .lean()
      .exec();

    const seenGoogleFiles = new Set<string>();
    const seenDocuments = new Set<string>();

    for (const message of messages) {
      const msg = message as any;

      if (msg.attachments) {
        for (const att of msg.attachments) {
          if (att.type === 'google') {
            const fileId = att.googleFileId || att.fileId;
            if (!seenGoogleFiles.has(fileId)) {
              seenGoogleFiles.add(fileId);
              allFiles.push({
                id: fileId,
                name: att.fileName,
                size: att.fileSize || 0,
                type: 'google',
                mimeType: att.mimeType,
                fileType: att.fileType,
                url: att.webViewLink || att.url,
                uploadedAt: att.createdTime
                  ? new Date(att.createdTime)
                  : msg.createdAt,
                source: 'Google Drive',
                conversationId: msg.conversationId?.toString(),
              });
            }
          }
        }
      }

      if (msg.attachedDocuments) {
        for (const doc of msg.attachedDocuments) {
          if (!seenDocuments.has(doc.documentId)) {
            seenDocuments.add(doc.documentId);
            allFiles.push({
              id: doc.documentId,
              name: doc.fileName,
              size: 0,
              type: 'document',
              fileType: doc.fileType,
              uploadedAt: msg.createdAt,
              source: 'Document',
              chunksCount: doc.chunksCount,
              documentId: doc.documentId,
              conversationId: msg.conversationId?.toString(),
            });
          }
        }
      }
    }

    allFiles.sort(
      (a, b) =>
        new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
    );

    return allFiles;
  }
}
