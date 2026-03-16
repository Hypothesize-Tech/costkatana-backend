import {
  IsNotEmpty,
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

export class IVariableDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  defaultValue?: string;

  @IsBoolean()
  required: boolean;

  @IsOptional()
  @IsIn(['text', 'image'])
  type?: 'text' | 'image';

  @IsOptional()
  @IsIn(['reference', 'evidence'])
  imageRole?: 'reference' | 'evidence';

  @IsOptional()
  @IsString()
  s3Url?: string;

  @IsOptional()
  @IsString()
  accept?: string;

  @IsOptional()
  @IsObject()
  metadata?: {
    format?: string;
    dimensions?: string;
    uploadedAt?: Date;
  };
}

export class SharingDto {
  @IsOptional()
  @IsIn(['private', 'project', 'organization', 'public'])
  visibility?: 'private' | 'project' | 'organization' | 'public';

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  sharedWith?: string[];

  @IsOptional()
  @IsBoolean()
  allowFork?: boolean;
}

export class CreateTemplateDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  content: string;

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
