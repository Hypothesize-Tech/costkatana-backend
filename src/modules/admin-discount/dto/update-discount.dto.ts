import { CreateDiscountDto } from './create-discount.dto';
import { IsNumber, IsOptional, Min } from 'class-validator';

/**
 * Update DTO: all CreateDiscountDto fields optional, plus optional minAmount.
 * Equivalent to PartialType(CreateDiscountDto) from @nestjs/mapped-types.
 */
export class UpdateDiscountDto implements Partial<CreateDiscountDto> {
  @IsOptional()
  code?: string;

  @IsOptional()
  type?: 'percentage' | 'fixed';

  @IsOptional()
  amount?: number;

  @IsOptional()
  validFrom?: Date | string;

  @IsOptional()
  validUntil?: Date | string;

  @IsOptional()
  maxUses?: number;

  @IsOptional()
  applicablePlans?: ('free' | 'plus' | 'pro' | 'enterprise')[];

  @IsOptional()
  @IsNumber()
  @Min(1, {
    message:
      'Minimum amount must be at least 1.00 to meet payment gateway requirements',
  })
  minAmount?: number;

  @IsOptional()
  userId?: string;

  @IsOptional()
  isActive?: boolean;

  @IsOptional()
  description?: string;
}
