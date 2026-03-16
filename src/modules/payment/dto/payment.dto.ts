import { IsString, IsOptional, IsNumber, Min, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';

export class ConfirmStripePaymentDto {
  @IsOptional()
  @IsString()
  setupIntentId?: string;

  @IsString()
  paymentMethodId: string;

  @IsString()
  @IsIn(['plus', 'pro', 'enterprise'])
  plan: 'plus' | 'pro' | 'enterprise';

  @IsOptional()
  @IsString()
  @IsIn(['monthly', 'yearly'])
  billingInterval?: 'monthly' | 'yearly';

  @IsOptional()
  @IsString()
  discountCode?: string;
}

export class CreatePayPalPlanDto {
  @IsString()
  @IsIn(['plus', 'pro', 'enterprise'])
  plan: 'plus' | 'pro' | 'enterprise';

  @IsString()
  @IsIn(['monthly', 'yearly'])
  billingInterval: 'monthly' | 'yearly';

  @Transform(({ value }) => parseFloat(value))
  @IsNumber()
  @Min(0)
  amount: number;

  @IsOptional()
  @IsString()
  @IsIn(['USD', 'EUR', 'GBP'])
  currency?: string = 'USD';

  @IsOptional()
  @IsString()
  discountCode?: string;
}

export class ApprovePayPalDto {
  @IsString()
  subscriptionId: string;

  @IsString()
  @IsIn(['plus', 'pro', 'enterprise'])
  plan: 'plus' | 'pro' | 'enterprise';

  @IsString()
  @IsIn(['monthly', 'yearly'])
  billingInterval: 'monthly' | 'yearly';

  @IsOptional()
  @IsString()
  discountCode?: string;
}

export class CreateRazorpayOrderDto {
  @IsString()
  @IsIn(['plus', 'pro', 'enterprise'])
  plan: 'plus' | 'pro' | 'enterprise';

  @IsString()
  @IsIn(['monthly', 'yearly'])
  billingInterval: 'monthly' | 'yearly';

  @Transform(({ value }) => parseFloat(value))
  @IsNumber()
  @Min(0)
  amount: number;

  @IsOptional()
  @IsString()
  @IsIn(['USD', 'INR', 'EUR'])
  currency?: string = 'USD';

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  discountCode?: string;
}

export class ConfirmRazorpayPaymentDto {
  @IsString()
  paymentId: string;

  @IsString()
  orderId: string;

  @IsString()
  signature: string;

  @IsString()
  @IsIn(['plus', 'pro', 'enterprise'])
  plan: 'plus' | 'pro' | 'enterprise';

  @IsString()
  @IsIn(['monthly', 'yearly'])
  billingInterval: 'monthly' | 'yearly';

  @IsOptional()
  @IsString()
  discountCode?: string;
}
