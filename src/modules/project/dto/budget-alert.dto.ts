import {
  IsNumber,
  IsOptional,
  IsString,
  IsIn,
  IsArray,
  Min,
  Max,
} from 'class-validator';

export class BudgetAlertDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  threshold: number;

  @IsString()
  @IsIn(['email', 'in-app', 'both'])
  type: 'email' | 'in-app' | 'both';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  recipients?: string[];
}
