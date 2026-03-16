import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class UpdatePageViewMetricsDto {
  @IsString()
  pageId: string;

  @IsString()
  sessionId: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  timeOnPage?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  scrollDepth?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sectionsViewed?: string[];
}
