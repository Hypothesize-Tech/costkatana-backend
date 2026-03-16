import { IsEmail, IsString } from 'class-validator';

export class AddSecondaryEmailDto {
  @IsEmail({}, { message: 'Invalid email address' })
  email: string;
}

export class SetPrimaryEmailDto {
  @IsEmail({}, { message: 'Invalid email address' })
  email: string;
}

export class ResendVerificationDto {
  @IsEmail({}, { message: 'Invalid email address' })
  email: string;
}
