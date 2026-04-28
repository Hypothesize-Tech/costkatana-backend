/**
 * File Upload Module
 * Provides file upload (multipart), list, and delete with S3 and RAG ingestion.
 */

import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  UploadedFile,
  UploadedFileSchema,
} from '../../schemas/misc/uploaded-file.schema';
import {
  ChatMessage,
  ChatMessageSchema,
} from '../../schemas/chat/chat-message.schema';
import {
  Document as IngestedDocument,
  DocumentSchema,
} from '../../schemas/document/document.schema';
import { StorageModule } from '../storage/storage.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { AuthModule } from '../auth/auth.module';
import { FileUploadController } from './file-upload.controller';
import { FileUploadService } from './file-upload.service';

@Module({
  imports: [
    StorageModule,
    IngestionModule,
    AuthModule,
    MongooseModule.forFeature([
      { name: UploadedFile.name, schema: UploadedFileSchema },
      { name: ChatMessage.name, schema: ChatMessageSchema },
      { name: IngestedDocument.name, schema: DocumentSchema },
    ]),
  ],
  controllers: [FileUploadController],
  providers: [FileUploadService],
  exports: [FileUploadService],
})
export class FileUploadModule {}
