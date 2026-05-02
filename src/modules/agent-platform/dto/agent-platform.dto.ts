import {
  IsArray,
  IsEnum,
  IsMongoId,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import type { AgentDag } from '../interfaces/dag.interface';

export class CreateAgentDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /** Optional template slug — if provided, the agent's first version uses the template's DAG. */
  @IsOptional()
  @IsString()
  templateSlug?: string;

  @IsOptional()
  @IsMongoId()
  projectId?: string;

  @IsOptional()
  @IsMongoId()
  teamId?: string;
}

export class UpdateAgentDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsEnum(['draft', 'published', 'archived'])
  status?: 'draft' | 'published' | 'archived';
}

export class UpdateDagDto {
  @IsObject()
  dag!: AgentDag;

  @IsOptional()
  @IsString()
  changelog?: string;
}

export class PublishVersionDto {
  @IsMongoId()
  versionId!: string;

  @IsOptional()
  @IsString()
  changelog?: string;
}

export class TestRunDto {
  /** Optional override DAG (lets the user dry-run unsaved changes). */
  @IsOptional()
  @IsObject()
  dag?: AgentDag;

  /** Whatever payload the agent should receive — string or object. */
  input!: unknown;
}

export class ResumeRunDto {
  checkpointResponse!: unknown;
}
