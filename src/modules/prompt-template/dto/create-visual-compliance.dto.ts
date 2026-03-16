import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsArray,
  IsIn,
  IsObject,
  ValidateNested,
  IsMongoId,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IVariableDto } from './create-template.dto';

export class ComplianceCriteriaDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  whatToCheck?: string;

  @IsOptional()
  @IsString()
  howToMeasure?: string;

  @IsOptional()
  @IsString()
  passCriteria?: string;

  @IsOptional()
  @IsString()
  failCriteria?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  edgeCases?: string[];
}

export class CreateVisualComplianceDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsMongoId()
  projectId?: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(['jewelry', 'grooming', 'retail', 'fmcg', 'documents'])
  industry: 'jewelry' | 'grooming' | 'retail' | 'fmcg' | 'documents';

  @IsOptional()
  @IsIn(['optimized', 'standard'])
  mode?: 'optimized' | 'standard';

  @IsOptional()
  @IsString()
  metaPromptPresetId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ComplianceCriteriaDto)
  complianceCriteria?: ComplianceCriteriaDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IVariableDto)
  imageVariables?: IVariableDto[];

  @IsOptional()
  @IsObject()
  structuredData?: {
    colors?: {
      dominant?: string[];
      accent?: string[];
      background?: string;
    };
    layout?: {
      composition?: string;
      orientation?: string;
      spacing?: string;
    };
    objects?: Array<{
      name?: string;
      position?: string;
      description?: string;
      attributes?: Record<string, any>;
    }>;
    text?: {
      detected?: string[];
      prominent?: string[];
      language?: string;
    };
    lighting?: {
      type?: string;
      direction?: string;
      quality?: string;
    };
    quality?: {
      sharpness?: string;
      clarity?: string;
      professionalGrade?: boolean;
    };
  };

  @IsOptional()
  @IsString()
  referenceImageUrl?: string;
}
