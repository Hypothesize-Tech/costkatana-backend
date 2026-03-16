import { IsString, IsArray, ValidateNested, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class ParsedMentionDto {
  @IsString()
  integration: string; // 'jira', 'linear', 'slack', 'discord', 'github', etc.

  @IsString()
  @IsOptional()
  entityType?: string; // 'project', 'issue', 'team', 'channel', 'repository', etc.

  @IsString()
  @IsOptional()
  entityId?: string; // ID of the entity

  @IsString()
  @IsOptional()
  action?: string; // 'create', 'get', 'list', 'update', 'delete', etc.
}

export class ExecuteCommandDto {
  @IsString()
  message: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ParsedMentionDto)
  @IsOptional()
  mentions?: ParsedMentionDto[];
}
