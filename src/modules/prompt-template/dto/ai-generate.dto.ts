import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsIn,
  IsNumber,
  IsObject,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ContextDto {
  @IsOptional()
  @IsString()
  projectType?: string;

  @IsOptional()
  @IsString()
  industry?: string;

  @IsOptional()
  @IsString()
  targetAudience?: string;

  @IsOptional()
  @IsIn(['formal', 'casual', 'technical', 'creative'])
  tone?: 'formal' | 'casual' | 'technical' | 'creative';

  @IsOptional()
  @IsObject()
  examples?: string[];
}

export class ConstraintsDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxTokens?: number;

  @IsOptional()
  @IsString()
  targetModel?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  costLimit?: number;
}

export class AIGenerateDto {
  @IsString()
  @IsNotEmpty()
  intent: string;

  @IsOptional()
  @IsIn([
    'general',
    'coding',
    'writing',
    'analysis',
    'creative',
    'business',
    'custom',
    'visual-compliance',
  ])
  category?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ContextDto)
  context?: ContextDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConstraintsDto)
  constraints?: ConstraintsDto;
}
