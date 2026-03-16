import {
  IsOptional,
  IsBoolean,
  IsNumber,
  IsString,
  IsObject,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class EmailEngagementDto {
  @IsOptional()
  @IsNumber()
  totalSent?: number;

  @IsOptional()
  @IsNumber()
  totalOpened?: number;

  @IsOptional()
  @IsNumber()
  totalClicked?: number;

  @IsOptional()
  @IsNumber()
  consecutiveIgnored?: number;

  @IsOptional()
  @IsString()
  lastOpened?: string;
}

class IntegrationsDto {
  @IsOptional()
  alertTypeRouting?: Record<string, string[]>;

  @IsOptional()
  defaultChannels?: string[];

  @IsOptional()
  @IsBoolean()
  fallbackToEmail?: boolean;
}

export class UpdatePreferencesDto {
  @IsOptional()
  @IsBoolean()
  emailAlerts?: boolean;

  @IsOptional()
  @IsNumber()
  alertThreshold?: number;

  @IsOptional()
  @IsBoolean()
  optimizationSuggestions?: boolean;

  @IsOptional()
  @IsBoolean()
  enableSessionReplay?: boolean;

  @IsOptional()
  @IsNumber()
  sessionReplayTimeout?: number;

  @IsOptional()
  @IsString()
  lastDigestSent?: string;

  @IsOptional()
  @IsNumber()
  maxConcurrentUserSessions?: number;

  @IsOptional()
  @IsBoolean()
  userSessionNotificationEnabled?: boolean;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  dateFormat?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  theme?: string;

  @IsOptional()
  @IsString()
  emailDigest?: string;

  @IsOptional()
  @IsBoolean()
  autoOptimize?: boolean;

  @IsOptional()
  @IsBoolean()
  showCostInHeader?: boolean;

  @IsOptional()
  @IsBoolean()
  enableBetaFeatures?: boolean;

  @IsOptional()
  @IsBoolean()
  weeklyReports?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => EmailEngagementDto)
  emailEngagement?: EmailEngagementDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => IntegrationsDto)
  integrations?: IntegrationsDto;
}
