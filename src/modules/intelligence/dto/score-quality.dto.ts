import { IsString, IsOptional, IsIn, MinLength } from 'class-validator';

const METHODS = ['ai_model', 'automated', 'hybrid'] as const;

export class ScoreQualityDto {
  @IsString()
  @MinLength(1, { message: 'Prompt is required' })
  prompt: string;

  @IsString()
  @MinLength(1, { message: 'Response is required' })
  response: string;

  @IsOptional()
  @IsString()
  expectedOutput?: string;

  @IsOptional()
  @IsIn(METHODS)
  method?: (typeof METHODS)[number];
}
