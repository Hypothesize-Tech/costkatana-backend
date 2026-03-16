import {
  IsString,
  IsOptional,
  IsObject,
  IsArray,
  IsBoolean,
  ValidateNested,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';

// DTO for creating agent trace templates
export class CreateAgentTraceTemplateDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  version?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkflowStepTemplateDto)
  steps: WorkflowStepTemplateDto[];

  @IsOptional()
  @IsObject()
  variables?: Record<
    string,
    {
      type: 'string' | 'number' | 'boolean' | 'object';
      required: boolean;
      default?: any;
      description?: string;
    }
  >;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkflowTriggerDto)
  triggers?: WorkflowTriggerDto[];

  @IsOptional()
  @IsObject()
  settings?: {
    timeout?: number;
    retryPolicy?: {
      maxRetries: number;
      factor?: number;
      minTimeout: number;
    };
    parallelism?: number;
    caching?: boolean;
  };

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class WorkflowStepTemplateDto {
  @IsString()
  id: string;

  @IsString()
  name: string;

  @IsEnum([
    'llm_call',
    'api_call',
    'data_processing',
    'conditional',
    'parallel',
    'custom',
  ])
  type:
    | 'llm_call'
    | 'api_call'
    | 'data_processing'
    | 'conditional'
    | 'parallel'
    | 'custom';

  @IsOptional()
  @IsObject()
  metadata?: any;

  @IsArray()
  @IsString({ each: true })
  dependencies: string[];

  @IsOptional()
  @IsObject()
  conditions?: {
    if: string;
    then: string;
    else?: string;
  };
}

export class WorkflowTriggerDto {
  @IsEnum(['manual', 'webhook', 'schedule', 'event'])
  type: 'manual' | 'webhook' | 'schedule' | 'event';

  @IsObject()
  config: any;
}

// DTO for executing agent traces
export class ExecuteAgentTraceDto {
  @IsOptional()
  @IsObject()
  input?: any;

  @IsOptional()
  @IsObject()
  variables?: Record<string, any>;

  @IsOptional()
  @IsString()
  environment?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
