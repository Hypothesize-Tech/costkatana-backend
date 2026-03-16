import { IsOptional, IsString, IsNumber, IsIn } from 'class-validator';

export class ShareSessionDto {
  @IsOptional()
  @IsIn(['public', 'team', 'password'])
  accessLevel?: 'public' | 'team' | 'password';

  @IsOptional()
  @IsNumber()
  expiresIn?: number; // hours

  @IsOptional()
  @IsString()
  password?: string;
}
