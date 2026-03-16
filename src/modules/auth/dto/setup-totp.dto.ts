import { IsEmail, IsString } from 'class-validator';

export class SetupTOTPDto {
  @IsEmail()
  @IsString()
  email: string;
}
