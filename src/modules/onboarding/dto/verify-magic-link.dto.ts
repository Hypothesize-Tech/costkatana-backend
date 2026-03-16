import { IsString, IsNotEmpty } from 'class-validator';

export class VerifyMagicLinkDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}
