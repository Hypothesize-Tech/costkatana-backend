import {
  IsString,
  IsOptional,
  IsEnum,
  IsNotEmpty,
  MaxLength,
} from 'class-validator';

export class CreateNotebookDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

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
}
