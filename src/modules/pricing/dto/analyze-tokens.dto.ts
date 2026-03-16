import {
  IsString,
  IsArray,
  IsNumber,
  IsOptional,
  ValidateNested,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

class ModelInfoDto {
  @IsString()
  @MaxLength(100)
  provider: string;

  @IsString()
  @MaxLength(200)
  modelId: string;

  @IsOptional()
  @IsNumber()
  outputTokens?: number;
}

export class AnalyzeTokensDto {
  @IsString()
  @MaxLength(100000) // Reasonable limit for text analysis
  text: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ModelInfoDto)
  models?: ModelInfoDto[];
}
