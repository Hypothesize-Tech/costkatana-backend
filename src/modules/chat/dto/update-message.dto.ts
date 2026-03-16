/**
 * DTO for updating/editing a chat message
 */
import {
  IsString,
  IsOptional,
  MaxLength,
  IsObject,
  IsArray,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateMessageDto {
  @ApiPropertyOptional({
    description: 'Updated message content',
    example: 'Updated message content',
    maxLength: 10000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  content?: string;

  @ApiPropertyOptional({
    description: 'Additional metadata for the message',
    example: { edited: true, editReason: 'typo correction' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Updated attachments for the message',
    type: [Object],
  })
  @IsOptional()
  @IsArray()
  attachments?: Array<{
    type: 'uploaded' | 'google';
    fileId: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    fileType: string;
    url: string;
  }>;
}
