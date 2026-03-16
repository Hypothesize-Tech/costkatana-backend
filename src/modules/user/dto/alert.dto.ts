import { IsString, IsOptional, IsBoolean, IsNumber } from 'class-validator';

export class SnoozeAlertDto {
  @IsString()
  snoozeUntil: string; // ISO datetime string
}

export class UpdateAlertSettingsDto {
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
}

export class TestAlertDto {
  // No specific fields required for testing alerts
}
