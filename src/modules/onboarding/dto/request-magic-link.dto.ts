import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RequestMagicLinkDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsOptional()
  redirectUrl?: string;
}
