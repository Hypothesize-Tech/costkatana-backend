import {
  IsString,
  IsOptional,
  IsObject,
  Length,
  ValidateNested,
  IsArray,
  IsBoolean,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO for agent query requests (POST /api/agent/query)
 * Matches Express validation: body('query'), body('context')
 */
export class AgentQueryContextDto {
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  conversationId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AgentQueryMessageDto)
  previousMessages?: AgentQueryMessageDto[];

  @IsOptional()
  @IsBoolean()
  isProjectWizard?: boolean;

  @IsOptional()
  @IsString()
  projectType?: string;

  @IsOptional()
  @IsObject()
  wizardState?: any;

  @IsOptional()
  @IsArray()
  previousResponses?: any[];

  @IsOptional()
  @IsBoolean()
  useMultiAgent?: boolean;

  @IsOptional()
  @IsObject()
  knowledgeBaseContext?: any;

  @IsOptional()
  @IsObject()
  systemCapabilities?: any;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  availableAgentTypes?: string[];
}

export class AgentQueryMessageDto {
  @IsString()
  role: 'system' | 'user' | 'assistant';

  @IsString()
  content: string;

  @IsOptional()
  @IsObject()
  metadata?: any;
}

export class AgentQueryDto {
  @IsString()
  @Length(1, 5000, { message: 'Query must be between 1 and 5000 characters' })
  query: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AgentQueryContextDto)
  context?: AgentQueryContextDto;
}
