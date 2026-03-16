import {
  IsString,
  IsNumber,
  IsArray,
  IsObject,
  IsOptional,
  IsEnum,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class FeatureConfigDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, any>;
}

export class StartIntegrationDto {
  @IsString()
  userId: string;

  @IsString()
  connectionId: string;

  @IsNumber()
  repositoryId: number;

  @IsString()
  repositoryName: string;

  @IsString()
  repositoryFullName: string;

  @IsString()
  branchName: string;

  @IsEnum(['npm', 'cli', 'python', 'http-headers'])
  integrationType: 'npm' | 'cli' | 'python' | 'http-headers';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FeatureConfigDto)
  @ArrayMinSize(1)
  selectedFeatures: FeatureConfigDto[];

  @IsOptional()
  @IsString()
  conversationId?: string;
}
