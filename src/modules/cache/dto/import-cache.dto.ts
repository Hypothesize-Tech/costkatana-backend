import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
  Allow,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Metadata for a single cache entry (parity with Express CacheEntry.metadata). */
export class CacheEntryMetadataDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsNumber()
  timestamp: number;

  @IsNumber()
  ttl: number;

  @IsNumber()
  hits: number;

  @IsNumber()
  lastAccessed: number;

  @IsOptional()
  @IsNumber()
  tokens?: number;

  @IsOptional()
  @IsNumber()
  cost?: number;
}

/** Single cache entry for import (parity with Express CacheEntry). */
export class CacheEntryDto {
  @IsString()
  key: string;

  @Allow()
  value: unknown;

  @ValidateNested()
  @Type(() => CacheEntryMetadataDto)
  metadata: CacheEntryMetadataDto;
}

/**
 * Body DTO for import cache endpoint.
 * POST api/cache/import
 */
export class ImportCacheDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CacheEntryDto)
  entries: CacheEntryDto[];
}
