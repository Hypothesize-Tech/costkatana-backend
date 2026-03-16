import {
  IsOptional,
  IsNumber,
  IsString,
  IsArray,
  Min,
  Max,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { DateRangeQueryDto } from './date-range-query.dto';

export class StartVectorizationJobDto {
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(1.0)
  @Transform(({ value }) => parseFloat(value))
  samplingRate?: number = 0.1;

  @IsOptional()
  @IsString()
  vectorizationMethod?: string = 'pca';

  @IsOptional()
  @IsNumber()
  @Min(2)
  @Max(1024)
  @Transform(({ value }) => parseInt(value))
  targetDimensions?: number = 128;
}

export class VectorizationJobStatusDto {
  @IsString()
  jobId: string;
}

export class GenerateSmartSampleDto extends DateRangeQueryDto {
  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(100000)
  @Transform(({ value }) => parseInt(value))
  sampleSize?: number = 1000;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  stratificationFields?: string[] = ['service', 'model', 'userId'];
}

export class OptimizeSamplingParametersDto extends DateRangeQueryDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetMetrics?: string[] = ['cost', 'tokens', 'responseTime'];

  @IsOptional()
  @IsNumber()
  @Min(0.8)
  @Max(0.99)
  @Transform(({ value }) => parseFloat(value))
  confidenceLevel?: number = 0.95;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(0.2)
  @Transform(({ value }) => parseFloat(value))
  marginOfError?: number = 0.05;
}

export class SamplingQualityMetricsDto {
  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(100000)
  @Transform(({ value }) => parseInt(value))
  sampleSize?: number = 1000;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  stratificationFields?: string[] = ['service', 'model', 'userId'];
}

export class VectorizationHealthDto {}

export class TimeEstimateDto {
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(1.0)
  @Transform(({ value }) => parseFloat(value))
  samplingRate?: number = 0.1;

  @IsOptional()
  @IsString()
  vectorizationMethod?: string = 'pca';

  @IsOptional()
  @IsNumber()
  @Min(2)
  @Max(1024)
  @Transform(({ value }) => parseInt(value))
  targetDimensions?: number = 128;
}
