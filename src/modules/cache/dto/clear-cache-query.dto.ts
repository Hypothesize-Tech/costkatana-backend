import { IsOptional, IsString } from 'class-validator';

/**
 * Query DTO for clear cache endpoint.
 * GET/DELETE api/cache/clear?model=&provider=
 * userId is taken from JWT (authenticated user).
 */
export class ClearCacheQueryDto {
  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  provider?: string;
}
