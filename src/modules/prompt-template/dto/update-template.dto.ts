import {
  IsOptional,
  IsString,
  IsArray,
  IsBoolean,
  IsIn,
  IsMongoId,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IVariableDto, SharingDto } from './create-template.dto';

export class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsIn([
    'general',
    'coding',
    'writing',
    'analysis',
    'creative',
    'business',
    'custom',
    'visual-compliance',
  ])
  category?: string;

  @IsOptional()
  @IsMongoId()
  projectId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IVariableDto)
  variables?: IVariableDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => SharingDto)
  sharing?: SharingDto;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  language?: string;
}
