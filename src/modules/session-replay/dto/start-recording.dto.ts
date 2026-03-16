import { IsString, IsOptional, IsObject, MinLength } from 'class-validator';

export class StartRecordingDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  userId?: string;

  @IsString()
  @MinLength(1)
  feature: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
