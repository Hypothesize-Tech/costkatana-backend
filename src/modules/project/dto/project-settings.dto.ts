import {
  IsNumber,
  IsOptional,
  IsString,
  IsArray,
  IsBoolean,
  Min,
} from 'class-validator';

export class ProjectSettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  requireApprovalAbove?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedModels?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxTokensPerRequest?: number;

  @IsOptional()
  @IsBoolean()
  enablePromptLibrary?: boolean;

  @IsOptional()
  @IsBoolean()
  enableCostAllocation?: boolean;
}
