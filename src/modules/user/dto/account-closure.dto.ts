import { IsString, IsOptional, MinLength } from 'class-validator';

export class InitiateAccountClosureDto {
  @IsString()
  @MinLength(1, { message: 'Password is required' })
  password: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class ConfirmClosureDto {
  @IsString()
  @MinLength(1, { message: 'Token is required' })
  token: string;
}

export class CancelClosureDto {
  // No additional fields required
}

export class ReactivateAccountDto {
  // No additional fields required
}
