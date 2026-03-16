import { IsOptional, IsNumber, IsString, Min } from 'class-validator';

/**
 * Body DTO for create Razorpay payment method order endpoint.
 * POST api/billing/payment-methods/razorpay/create-order
 */
export class CreateRazorpayPmOrderDto {
  @IsOptional()
  @IsNumber()
  @Min(1.0)
  amount?: number = 1.0;

  @IsOptional()
  @IsString()
  currency?: string = 'USD';
}
