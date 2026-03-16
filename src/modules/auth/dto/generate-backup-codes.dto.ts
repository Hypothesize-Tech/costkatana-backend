import { IsString, MinLength, IsNotEmpty } from 'class-validator';

/**
 * DTO for POST /api/backup-codes/generate
 * Password is required to authorize generation of new backup codes.
 */
export class GenerateBackupCodesDto {
  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(1, { message: 'Password is required' })
  password: string;
}
