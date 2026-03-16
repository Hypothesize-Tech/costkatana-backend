import { IsString, IsOptional, IsEnum, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ConversationDataDto {
  @IsString()
  prompt: string;

  @IsString()
  response: string;

  @IsString()
  model: string;

  @IsOptional()
  tokens_used?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };

  @IsOptional()
  @IsString()
  conversation_id?: string;

  @IsOptional()
  @IsString()
  timestamp?: string;
}

export class ProjectDataDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  budget_amount?: number;

  @IsOptional()
  @IsEnum(['monthly', 'quarterly', 'yearly'])
  budget_period?: 'monthly' | 'quarterly' | 'yearly';
}

export class OnboardingDataDto {
  @IsString()
  email: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  preferences?: {
    use_case?: string;
    ai_coaching?: boolean;
    email_insights?: boolean;
  };
}

export const ChatGPT_ACTIONS = [
  'track_usage',
  'create_project',
  'get_projects',
  'get_analytics',
  'generate_magic_link',
  'check_connection',
] as const;
export type ChatGPTAction = (typeof ChatGPT_ACTIONS)[number];

/**
 * Body for POST /chatgpt/action (and legacy /track, /projects, etc.)
 */
export class ChatGPTActionDto {
  @IsOptional()
  @IsString()
  user_id?: string;

  @IsOptional()
  @IsString()
  api_key?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => OnboardingDataDto)
  onboarding?: OnboardingDataDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConversationDataDto)
  conversation_data?: ConversationDataDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ProjectDataDto)
  project?: ProjectDataDto;

  @IsEnum(ChatGPT_ACTIONS)
  action!: ChatGPTAction;
}
