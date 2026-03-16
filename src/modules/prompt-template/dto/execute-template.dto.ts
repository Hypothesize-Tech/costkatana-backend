import {
  IsOptional,
  IsString,
  IsObject,
  IsIn,
  IsMongoId,
} from 'class-validator';

export class ExecuteTemplateDto {
  @IsOptional()
  @IsObject()
  variables?: Record<string, any>;

  @IsOptional()
  @IsIn(['single', 'comparison', 'recommended'])
  mode?: 'single' | 'comparison' | 'recommended';

  @IsOptional()
  @IsString()
  modelId?: string;

  @IsOptional()
  @IsMongoId()
  projectId?: string;
}
