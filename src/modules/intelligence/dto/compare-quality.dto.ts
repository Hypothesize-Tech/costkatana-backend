import { IsString, IsNumber, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class CostSavingsDto {
  @IsNumber()
  amount: number;

  @IsNumber()
  percentage: number;
}

export class CompareQualityDto {
  @IsString()
  @MinLength(1)
  prompt: string;

  @IsString()
  @MinLength(1)
  originalResponse: string;

  @IsString()
  @MinLength(1)
  optimizedResponse: string;

  @ValidateNested()
  @Type(() => CostSavingsDto)
  costSavings: { amount: number; percentage: number };
}
