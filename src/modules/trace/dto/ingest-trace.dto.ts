import {
  IsString,
  IsOptional,
  IsEnum,
  IsObject,
  IsNumber,
  IsArray,
  ValidateNested,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

class IngestTraceErrorDto {
  @IsString()
  message: string;

  @IsOptional()
  @IsString()
  stack?: string;
}

class IngestTraceTokensDto {
  @IsNumber()
  input: number;

  @IsNumber()
  output: number;
}

export class IngestTraceDto {
  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsEnum(['http', 'llm', 'tool', 'database', 'custom'])
  type?: 'http' | 'llm' | 'tool' | 'database' | 'custom';

  @IsOptional()
  @IsEnum(['ok', 'error'])
  status?: 'ok' | 'error';

  @IsDateString()
  startedAt: string;

  @IsOptional()
  @IsDateString()
  endedAt?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => IngestTraceErrorDto)
  error?: IngestTraceErrorDto;

  @IsOptional()
  @IsString()
  aiModel?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => IngestTraceTokensDto)
  tokens?: IngestTraceTokensDto;

  @IsOptional()
  @IsNumber()
  costUSD?: number;

  @IsOptional()
  @IsString()
  tool?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  resourceIds?: string[];

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
