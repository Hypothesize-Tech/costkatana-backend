import { IsString, IsOptional } from 'class-validator';

/**
 * Query DTO for GET /ckql/vectorization/status.
 */
export class GetVectorizationStatusQueryDto {
  @IsOptional()
  @IsString()
  tenant_id?: string;

  @IsOptional()
  @IsString()
  workspace_id?: string;
}
