import {
  IsOptional,
  IsString,
  IsNumber,
  IsBoolean,
  IsArray,
  IsIn,
  Min,
  Max,
} from 'class-validator';

export class UpdateModelDto {
  @IsOptional()
  @IsString()
  modelName?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  inputPricePerMToken?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  outputPricePerMToken?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cachedInputPricePerMToken?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  contextWindow?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  capabilities?: string[];

  @IsOptional()
  @IsIn(['text', 'multimodal', 'embedding', 'code'])
  category?: 'text' | 'multimodal' | 'embedding' | 'code';

  @IsOptional()
  @IsBoolean()
  isLatest?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isDeprecated?: boolean;
}
