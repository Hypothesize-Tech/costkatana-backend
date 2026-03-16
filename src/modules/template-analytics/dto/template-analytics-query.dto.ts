import {
  IsOptional,
  IsString,
  IsIn,
  IsMongoId,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class TemplateAnalyticsQueryDto {
  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsIn(['chat', 'optimization', 'visual-compliance', 'workflow', 'api'])
  context?: 'chat' | 'optimization' | 'visual-compliance' | 'workflow' | 'api';

  @IsOptional()
  @IsMongoId()
  templateId?: string;

  @IsOptional()
  @IsIn(['24h', '7d', '30d', '90d'])
  period?: '24h' | '7d' | '30d' | '90d';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
