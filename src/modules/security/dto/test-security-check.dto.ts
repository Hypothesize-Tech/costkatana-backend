import { IsString, IsOptional, IsArray, MinLength } from 'class-validator';

export class TestSecurityCheckDto {
  @IsString()
  @MinLength(1)
  prompt: string;

  @IsOptional()
  @IsArray()
  retrievedChunks?: string[];

  @IsOptional()
  @IsArray()
  toolCalls?: any[];

  @IsOptional()
  @IsString()
  provenanceSource?: string;
}
