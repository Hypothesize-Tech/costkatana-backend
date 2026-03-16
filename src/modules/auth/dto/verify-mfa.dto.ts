import { IsString, IsIn, IsOptional, IsBoolean } from 'class-validator';

export class VerifyMFADto {
  @IsString()
  mfaToken: string;

  @IsString()
  @IsIn(['email', 'totp'])
  method: 'email' | 'totp';

  @IsString()
  code: string;

  @IsOptional()
  @IsBoolean()
  rememberDevice?: boolean;

  @IsOptional()
  @IsString()
  deviceName?: string;
}
