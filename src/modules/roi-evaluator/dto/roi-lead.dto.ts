import { IsString, IsEmail, IsOptional, IsObject, IsBoolean } from 'class-validator';

export class RoiLeadDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsOptional()
  companyName?: string;

  @IsString()
  @IsOptional()
  roiResultId?: string;

  @IsObject()
  @IsOptional()
  roiResultSnapshot?: Record<string, unknown>;

  /** When true, skip sending email (e.g. when Resend sends from frontend) */
  @IsBoolean()
  @IsOptional()
  skipEmail?: boolean;
}
