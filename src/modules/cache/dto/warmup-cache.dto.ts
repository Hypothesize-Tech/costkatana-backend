import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
  Allow,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Metadata for a warmup query (optional userId, model, provider, ttl). */
export class WarmupQueryMetadataDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsNumber()
  ttl?: number;
}

/** Single warmup query (parity with Express warmupCache body). */
export class WarmupQueryDto {
  @IsString()
  prompt: string;

  @Allow()
  response: unknown;

  @IsOptional()
  @ValidateNested()
  @Type(() => WarmupQueryMetadataDto)
  metadata?: WarmupQueryMetadataDto;
}

/**
 * Body DTO for warmup cache endpoint.
 * POST api/cache/warmup
 */
export class WarmupCacheDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WarmupQueryDto)
  queries: WarmupQueryDto[];
}
