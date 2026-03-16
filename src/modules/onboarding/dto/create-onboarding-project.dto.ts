import { Type } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsNumber,
  Min,
  MinLength,
  MaxLength,
  IsIn,
  ValidateNested,
} from 'class-validator';
import { ProjectSettingsDto } from '../../project/dto/project-settings.dto';

export class OnboardingBudgetDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsString()
  @IsIn(['monthly', 'quarterly', 'yearly', 'one-time'])
  period?: 'monthly' | 'quarterly' | 'yearly' | 'one-time';

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  currency?: string;
}

export class CreateOnboardingProjectDto {
  @IsString()
  @MinLength(1, { message: 'Project name is required' })
  @MaxLength(100, {
    message: 'Project name must be between 1 and 100 characters',
  })
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Description must be less than 500 characters' })
  description?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => OnboardingBudgetDto)
  budget?: OnboardingBudgetDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ProjectSettingsDto)
  settings?: ProjectSettingsDto;
}
