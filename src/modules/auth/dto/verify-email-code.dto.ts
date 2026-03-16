import { IsString, Length } from 'class-validator';

export class VerifyEmailCodeDto {
  @IsString()
  @Length(6, 6)
  code: string;
}
