import {
  IsString,
  IsOptional,
  IsBoolean,
  IsIn,
  IsNumber,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class UpgradeSubscriptionDto {
  @IsString()
  @IsIn(['free', 'plus', 'pro', 'enterprise'])
  plan: 'free' | 'plus' | 'pro' | 'enterprise';

  @IsOptional()
  @IsString()
  @IsIn(['stripe', 'razorpay', 'paypal'])
  paymentGateway?: 'stripe' | 'razorpay' | 'paypal';

  @IsOptional()
  @IsString()
  paymentMethodId?: string;

  @IsOptional()
  @IsString()
  @IsIn(['monthly', 'yearly'])
  interval?: 'monthly' | 'yearly';

  @IsOptional()
  @IsString()
  discountCode?: string;
}

export class DowngradeSubscriptionDto {
  @IsString()
  @IsIn(['free', 'plus', 'pro'])
  plan: 'free' | 'plus' | 'pro';

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  scheduleForPeriodEnd?: boolean = true;
}

export class CancelSubscriptionDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  cancelAtPeriodEnd?: boolean = true;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class PauseSubscriptionDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class UpdatePaymentMethodDto {
  @IsString()
  paymentMethodId: string;
}

export class UpdateBillingCycleDto {
  @IsString()
  @IsIn(['monthly', 'yearly'])
  interval: 'monthly' | 'yearly';
}

export class ValidateDiscountDto {
  @IsString()
  code: string;

  @IsOptional()
  @IsString()
  @IsIn(['free', 'plus', 'pro', 'enterprise'])
  plan?: 'free' | 'plus' | 'pro' | 'enterprise';

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber()
  @Min(0)
  amount?: number;
}

export class ApplyDiscountDto {
  @IsString()
  code: string;
}

export class UpdateSubscriptionDto {
  @IsString()
  @IsIn(['free', 'plus', 'pro', 'enterprise'])
  plan: 'free' | 'plus' | 'pro' | 'enterprise';

  @IsOptional()
  @IsString()
  @IsIn(['stripe', 'razorpay', 'paypal'])
  paymentGateway?: 'stripe' | 'razorpay' | 'paypal';

  @IsOptional()
  @IsString()
  paymentMethodId?: string;

  @IsOptional()
  @IsString()
  @IsIn(['monthly', 'yearly'])
  interval?: 'monthly' | 'yearly';

  @IsOptional()
  @IsString()
  discountCode?: string;
}
