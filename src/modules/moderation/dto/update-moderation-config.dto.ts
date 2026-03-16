import {
  IsOptional,
  IsObject,
  IsBoolean,
  IsNumber,
  IsIn,
} from 'class-validator';

export class InputModerationDto {
  @IsOptional()
  @IsBoolean()
  enableBasicFirewall?: boolean;

  @IsOptional()
  @IsBoolean()
  enableAdvancedFirewall?: boolean;

  @IsOptional()
  @IsNumber()
  promptGuardThreshold?: number;

  @IsOptional()
  @IsNumber()
  openaiSafeguardThreshold?: number;
}

export class OutputModerationDto {
  @IsOptional()
  @IsBoolean()
  enableOutputModeration?: boolean;

  @IsOptional()
  @IsNumber()
  toxicityThreshold?: number;

  @IsOptional()
  @IsBoolean()
  enablePIIDetection?: boolean;

  @IsOptional()
  @IsBoolean()
  enableToxicityCheck?: boolean;

  @IsOptional()
  @IsBoolean()
  enableHateSpeechCheck?: boolean;

  @IsOptional()
  @IsBoolean()
  enableSexualContentCheck?: boolean;

  @IsOptional()
  @IsBoolean()
  enableViolenceCheck?: boolean;

  @IsOptional()
  @IsBoolean()
  enableSelfHarmCheck?: boolean;

  @IsOptional()
  @IsIn(['block', 'redact', 'annotate'])
  action?: 'block' | 'redact' | 'annotate';
}

export class PiiDetectionDto {
  @IsOptional()
  @IsBoolean()
  enablePIIDetection?: boolean;

  @IsOptional()
  @IsBoolean()
  useAI?: boolean;

  @IsOptional()
  @IsBoolean()
  sanitizationEnabled?: boolean;
}

export class UpdateModerationConfigDto {
  @IsOptional()
  @IsObject()
  inputModeration?: InputModerationDto;

  @IsOptional()
  @IsObject()
  outputModeration?: OutputModerationDto;

  @IsOptional()
  @IsObject()
  piiDetection?: PiiDetectionDto;
}
