import {
  IsArray,
  IsOptional,
  IsDateString,
  IsString,
  ArrayMinSize,
} from 'class-validator';

export class BatchTagAnalyticsDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  tags: string[];

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
