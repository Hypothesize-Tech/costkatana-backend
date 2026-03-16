import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class FeatureConfigDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, any>;
}

export class UpdateIntegrationDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FeatureConfigDto)
  selectedFeatures?: FeatureConfigDto[];

  @IsOptional()
  @IsString()
  conversationId?: string;
}
