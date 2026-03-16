import { IsString, IsIn } from 'class-validator';

export const ONBOARDING_STEP_IDS = [
  'welcome',
  'project_creation',
  'project_pricing',
  'llm_query',
  'completion',
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEP_IDS)[number];

export class CompleteStepDto {
  @IsString()
  @IsIn(ONBOARDING_STEP_IDS, {
    message: `stepId must be one of: ${ONBOARDING_STEP_IDS.join(', ')}`,
  })
  stepId: OnboardingStepId;

  /** Optional payload for step completion (e.g. project_creation can pass projectId). */
  data?: Record<string, unknown>;
}
