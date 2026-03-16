import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class ValidateActionDto {
  @IsString()
  @IsNotEmpty()
  action: string;

  @IsString()
  @IsOptional()
  region?: string;

  @IsString()
  @IsNotEmpty()
  connectionId: string;
}
