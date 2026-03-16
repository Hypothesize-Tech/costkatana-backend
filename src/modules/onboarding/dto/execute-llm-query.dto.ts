import { IsString, IsIn, MinLength, MaxLength } from 'class-validator';

export const ONBOARDING_LLM_MODELS = [
  'gpt-3.5-turbo',
  'gpt-4',
  'claude-3-sonnet',
  'claude-3-opus',
  'gemini-pro',
] as const;

export type OnboardingLlmModel = (typeof ONBOARDING_LLM_MODELS)[number];

export class ExecuteLlmQueryDto {
  @IsString()
  @MinLength(1, { message: 'Query is required' })
  @MaxLength(1000, { message: 'Query must be between 1 and 1000 characters' })
  query: string;

  @IsString()
  @IsIn(ONBOARDING_LLM_MODELS, {
    message: `model must be one of: ${ONBOARDING_LLM_MODELS.join(', ')}`,
  })
  model: OnboardingLlmModel;
}
