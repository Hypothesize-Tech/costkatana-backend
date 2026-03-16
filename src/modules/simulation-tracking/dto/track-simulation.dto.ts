import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  IsObject,
  IsIn,
  Min,
  MinLength,
} from 'class-validator';

const SIMULATION_TYPES = [
  'real_time_analysis',
  'prompt_optimization',
  'context_trimming',
  'model_comparison',
] as const;

export class TrackSimulationDto {
  @IsString()
  @MinLength(1, { message: 'sessionId is required' })
  sessionId: string;

  @IsOptional()
  @IsString()
  originalUsageId?: string;

  @IsString()
  @IsIn(SIMULATION_TYPES, {
    message: 'simulationType must be one of: ' + SIMULATION_TYPES.join(', '),
  })
  simulationType: (typeof SIMULATION_TYPES)[number];

  @IsString()
  @MinLength(1, { message: 'originalModel is required' })
  originalModel: string;

  @IsString()
  @MinLength(1, { message: 'originalPrompt is required' })
  originalPrompt: string;

  @IsNumber()
  @Min(0)
  originalCost: number;

  @IsNumber()
  @Min(0)
  originalTokens: number;

  @IsOptional()
  @IsObject()
  parameters?: {
    temperature?: number;
    maxTokens?: number;
    trimPercentage?: number;
    alternativeModels?: string[];
  };

  @IsOptional()
  @IsArray()
  optimizationOptions?: Array<{
    type: string;
    description: string;
    newModel?: string;
    newCost?: number;
    savings?: number;
    savingsPercentage?: number;
    risk?: 'low' | 'medium' | 'high';
    implementation?: 'easy' | 'moderate' | 'complex';
    confidence?: number;
  }>;

  @IsOptional()
  @IsArray()
  recommendations?: unknown[];

  @IsNumber()
  @Min(0)
  potentialSavings: number;

  @IsNumber()
  @Min(0)
  confidence: number;

  @IsOptional()
  @IsString()
  projectId?: string;
}
