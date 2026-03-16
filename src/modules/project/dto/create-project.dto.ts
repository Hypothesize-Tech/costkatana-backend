import { Type } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsArray,
  ValidateNested,
  MinLength,
  MaxLength,
} from 'class-validator';
import { BudgetDto } from './budget.dto';
import { ProjectSettingsDto } from './project-settings.dto';

export class CreateProjectDto {
  @IsString()
  @MinLength(1, { message: 'Project name is required' })
  @MaxLength(256)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ValidateNested()
  @Type(() => BudgetDto)
  budget: BudgetDto;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ProjectSettingsDto)
  settings?: ProjectSettingsDto;
}
