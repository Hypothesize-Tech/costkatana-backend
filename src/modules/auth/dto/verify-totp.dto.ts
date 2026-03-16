import { IsString, Length } from 'class-validator';

export class VerifyTOTPDto {
  @IsString()
  @Length(6, 8)
  token: string;
}
