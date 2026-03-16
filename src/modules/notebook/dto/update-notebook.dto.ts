import {
  IsString,
  IsOptional,
  IsEnum,
  MaxLength,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

interface INotebookCell {
  id: string;
  type: 'markdown' | 'query' | 'visualization' | 'insight';
  content: string;
  output?: any;
  metadata?: Record<string, any>;
}

export class UpdateNotebookDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  title?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsEnum(['cost_spike', 'model_performance', 'usage_patterns', 'custom'])
  template_type?:
    | 'cost_spike'
    | 'model_performance'
    | 'usage_patterns'
    | 'custom';

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Object)
  cells?: INotebookCell[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
