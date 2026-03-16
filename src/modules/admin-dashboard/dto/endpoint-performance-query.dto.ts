import { IsOptional, IsInt, Min, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';
import { DateRangeQueryDto } from './date-range-query.dto';

export class EndpointPerformanceQueryDto extends DateRangeQueryDto {}

export class EndpointTrendsQueryDto extends DateRangeQueryDto {
  @Transform(({ value }) => value)
  endpoint: string;

  @IsOptional()
  @IsIn(['daily', 'hourly'])
  period?: string = 'daily';
}

export class TopEndpointsQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsIn(['requests', 'cost', 'tokens'])
  metric?: string = 'requests';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => parseInt(value))
  limit?: number = 10;
}

export class SlowestEndpointsQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => parseInt(value))
  limit?: number = 10;
}

export class ErrorProneEndpointsQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => parseInt(value))
  limit?: number = 10;
}
