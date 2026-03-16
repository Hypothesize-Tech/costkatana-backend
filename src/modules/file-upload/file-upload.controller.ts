/**
 * File Upload Controller
 * REST API for file upload, list, and delete.
 * Prefix: api/files (set on controller, not global).
 */

import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile as UploadedFileDecorator,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FileUploadService } from './file-upload.service';

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB

@Controller('api/files')
@UseGuards(JwtAuthGuard)
export class FileUploadController {
  private readonly logger = new Logger(FileUploadController.name);

  constructor(private readonly fileUploadService: FileUploadService) {}

  /**
   * POST api/files/upload
   * Upload a file (multipart/form-data, field name: file)
   */
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
    }),
  )
  async uploadFile(
    @UploadedFileDecorator()
    file: Express.Multer.File,
    @CurrentUser() user: { id?: string; _id?: string; userId?: string },
  ) {
    const userId = user?.id ?? user?._id ?? user?.userId;
    if (!userId) {
      throw new BadRequestException('Unauthorized');
    }

    if (!file || !file.buffer) {
      throw new BadRequestException('No file provided');
    }

    const result = await this.fileUploadService.uploadFile(
      String(userId),
      file.buffer,
      file.originalname,
      file.mimetype,
      file.size,
    );

    return {
      success: true,
      data: {
        fileId: result.fileId,
        documentId: result.documentId,
        fileName: result.fileName,
        fileSize: result.fileSize,
        mimeType: result.mimeType,
        fileType: result.fileType,
        url: result.url,
        uploadedAt: result.uploadedAt,
        ingested: result.ingested,
        chunksCreated: result.chunksCreated,
        ...(result.ingestionError && {
          ingestionError: result.ingestionError,
        }),
      },
    };
  }

  /**
   * DELETE api/files/:fileId
   * Delete a file by id (must belong to current user)
   */
  @Delete(':fileId')
  async deleteFile(
    @Param('fileId', ParseObjectIdPipe) fileId: string,
    @CurrentUser() user: { id?: string; _id?: string; userId?: string },
  ) {
    const userId = user?.id ?? user?._id ?? user?.userId;
    if (!userId) {
      throw new BadRequestException('Unauthorized');
    }

    await this.fileUploadService.deleteFile(String(fileId), String(userId));

    return {
      success: true,
      message: 'File deleted successfully',
    };
  }

  /**
   * GET api/files/all
   * Get ALL user's files from all sources (uploaded, Google Drive, documents)
   */
  @Get('all')
  async getAllUserFiles(
    @Query('conversationId') conversationId: string | undefined,
    @CurrentUser() user: { id?: string; _id?: string; userId?: string },
  ) {
    const userId = user?.id ?? user?._id ?? user?.userId;
    if (!userId) {
      throw new BadRequestException('Unauthorized');
    }

    const data = await this.fileUploadService.getAllUserFiles(
      String(userId),
      conversationId,
    );

    return {
      success: true,
      data,
    };
  }

  /**
   * GET api/files
   * Get user's uploaded files only (with optional conversationId filter)
   */
  @Get()
  async getUserFiles(
    @Query('conversationId') conversationId: string | undefined,
    @CurrentUser() user: { id?: string; _id?: string; userId?: string },
  ) {
    const userId = user?.id ?? user?._id ?? user?.userId;
    if (!userId) {
      throw new BadRequestException('Unauthorized');
    }

    const data = await this.fileUploadService.getUserFiles(
      String(userId),
      conversationId,
    );

    return {
      success: true,
      data,
    };
  }
}
