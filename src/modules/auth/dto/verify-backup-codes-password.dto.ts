import { IsString, MinLength, IsNotEmpty } from 'class-validator';

/**
 * DTO for POST /api/backup-codes/verify-password
 * Used before showing backup code operations.
 */
export class VerifyBackupCodesPasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(1, { message: 'Password is required' })
  password: string;
}
