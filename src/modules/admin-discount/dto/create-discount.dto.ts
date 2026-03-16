import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsArray,
  IsIn,
  Min,
  MinLength,
} from 'class-validator';

export class CreateDiscountDto {
  @IsString()
  @MinLength(1, { message: 'Code is required' })
  code: string;

  @IsIn(['percentage', 'fixed'])
  type: 'percentage' | 'fixed';

  @IsNumber()
  @Min(0)
  amount: number;

  @IsOptional()
  validFrom?: Date | string;

  @IsOptional()
  validUntil?: Date | string;

  @IsOptional()
  @IsNumber()
  maxUses?: number;

  @IsOptional()
  @IsArray()
  @IsIn(['free', 'plus', 'pro', 'enterprise'], { each: true })
  applicablePlans?: ('free' | 'plus' | 'pro' | 'enterprise')[];

  @IsOptional()
  @IsNumber()
  @Min(1, {
    message:
      'Minimum amount must be at least 1.00 to meet payment gateway requirements',
  })
  minAmount?: number;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  description?: string;
}
