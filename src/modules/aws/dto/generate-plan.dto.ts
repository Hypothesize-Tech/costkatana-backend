import { IsString, IsNotEmpty, IsArray, IsOptional } from 'class-validator';

export class GeneratePlanDto {
  @IsString()
  @IsNotEmpty()
  intent: string;

  @IsString()
  @IsNotEmpty()
  connectionId: string;

  @IsArray()
  @IsOptional()
  resources?: string[];
}
