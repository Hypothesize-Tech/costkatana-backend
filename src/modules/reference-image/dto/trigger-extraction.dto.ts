import { IsOptional, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

export class TriggerExtractionDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  forceRefresh?: boolean;
}
