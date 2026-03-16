import { IsOptional, IsDateString, IsString, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

export class TagAnalyticsQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  tagFilter?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeHierarchy?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeRealTime?: boolean;
}
