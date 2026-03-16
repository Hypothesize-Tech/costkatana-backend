import { IsString, IsOptional, MaxLength, MinLength } from 'class-validator';

export class AppealModerationDto {
  @IsString()
  @MinLength(1, { message: 'threatId is required' })
  threatId: string;

  @IsString()
  @MinLength(1, { message: 'reason is required' })
  @MaxLength(2000)
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  additionalContext?: string;
}
