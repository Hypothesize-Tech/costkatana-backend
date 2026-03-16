import { IsString, IsIn } from 'class-validator';

export class DisableMFADto {
  @IsString()
  @IsIn(['email', 'totp'])
  method: 'email' | 'totp';
}
