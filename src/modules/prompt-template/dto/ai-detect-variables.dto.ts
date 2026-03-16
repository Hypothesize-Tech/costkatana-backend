import { IsNotEmpty, IsOptional, IsString, IsBoolean } from 'class-validator';

export class AIDetectVariablesDto {
  @IsString()
  @IsNotEmpty()
  content: string;

  @IsOptional()
  @IsBoolean()
  autoFillDefaults?: boolean;

  @IsOptional()
  @IsBoolean()
  validateTypes?: boolean;
}
