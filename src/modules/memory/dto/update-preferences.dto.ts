import {
  IsOptional,
  IsString,
  IsIn,
  IsArray,
  IsBoolean,
} from 'class-validator';

export class UpdatePreferencesDto {
  @IsOptional()
  @IsString()
  preferredModel?: string;

  @IsOptional()
  @IsIn(['fastest', 'cheapest', 'balanced'])
  preferredChatMode?: 'fastest' | 'cheapest' | 'balanced';

  @IsOptional()
  @IsString()
  preferredStyle?: string;

  @IsOptional()
  @IsIn(['concise', 'detailed', 'comprehensive'])
  responseLength?: 'concise' | 'detailed' | 'comprehensive';

  @IsOptional()
  @IsIn(['beginner', 'intermediate', 'expert'])
  technicalLevel?: 'beginner' | 'intermediate' | 'expert';

  @IsOptional()
  @IsArray()
  commonTopics?: string[];

  @IsOptional()
  @IsIn(['cheap', 'balanced', 'premium'])
  costPreference?: 'cheap' | 'balanced' | 'premium';

  @IsOptional()
  notificationPreferences?: {
    email: boolean;
    push: boolean;
    sms: boolean;
  };

  @IsOptional()
  privacySettings?: {
    shareData: boolean;
    trackUsage: boolean;
    personalizedRecommendations: boolean;
  };
}
