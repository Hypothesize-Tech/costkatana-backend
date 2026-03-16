import {
  IsOptional,
  IsString,
  IsNumber,
  IsEnum,
  IsObject,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  sort?: string;

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc';
}

/** Filter + pagination for optimization list (controller uses this for GET /optimizations). */
export class OptimizationFilterQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minSavings?: number;

  @IsOptional()
  startDate?: Date;

  @IsOptional()
  endDate?: Date;
}

/** Re-export from dedicated DTO files for better organization */
export { OptimizationFeedbackDto as FeedbackDto } from './optimization-feedback.dto';
export { GetOptimizationsDto } from './get-optimizations.dto';

export class BatchOptimizationDto {
  @IsString()
  userId: string;

  requests: Array<{
    id: string;
    prompt: string;
    timestamp: number;
    model: string;
    provider: string;
  }>;

  @IsOptional()
  enableFusion?: boolean;
}

export class ConversationOptimizationDto {
  @IsString()
  userId: string;

  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: Date;
  }>;

  @IsString()
  model: string;

  @IsString()
  service: string;

  @IsOptional()
  @IsObject()
  options?: {
    enableCompression?: boolean;
    enableContextTrimming?: boolean;
  };
}

export class OptimizationPreviewDto {
  @IsString()
  userId: string;

  @IsString()
  prompt: string;

  @IsString()
  model: string;

  @IsString()
  service: string;

  @IsOptional()
  @IsString()
  conversationHistory?: any;

  @IsOptional()
  enableCompression?: boolean;

  @IsOptional()
  enableContextTrimming?: boolean;

  @IsOptional()
  enableRequestFusion?: boolean;
}
