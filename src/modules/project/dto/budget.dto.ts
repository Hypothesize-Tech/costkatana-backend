import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  IsIn,
  IsArray,
  ValidateNested,
  Min,
} from 'class-validator';
import { BudgetAlertDto } from './budget-alert.dto';

export class BudgetDto {
  @IsNumber()
  @Min(0)
  amount: number;

  @IsString()
  @IsIn(['monthly', 'quarterly', 'yearly', 'one-time'])
  period: 'monthly' | 'quarterly' | 'yearly' | 'one-time';

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BudgetAlertDto)
  alerts?: BudgetAlertDto[];
}
