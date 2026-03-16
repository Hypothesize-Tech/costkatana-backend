import { IsOptional, IsString, IsMongoId } from 'class-validator';
import { DateRangeQueryDto } from './date-range-query.dto';

export class ModelComparisonQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsString()
  service?: string;

  @IsOptional()
  @IsMongoId()
  userId?: string;
}

export class ServiceComparisonQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsMongoId()
  userId?: string;
}
