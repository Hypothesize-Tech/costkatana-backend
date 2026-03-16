import {
  IsOptional,
  IsString,
  IsArray,
  IsBoolean,
  IsMongoId,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IVariableDto, SharingDto } from './create-template.dto';

export class DuplicateTemplateDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsMongoId()
  projectId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SharingDto)
  sharing?: SharingDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IVariableDto)
  variables?: IVariableDto[];

  @IsOptional()
  @IsBoolean()
  keepVariables?: boolean;

  @IsOptional()
  @IsBoolean()
  keepSharing?: boolean;
}
