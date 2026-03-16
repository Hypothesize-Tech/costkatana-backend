import { IsString, IsOptional, IsBoolean } from 'class-validator';

/**
 * Body DTO for save Razorpay payment method endpoint.
 * POST api/billing/payment-methods/razorpay/save
 */
export class SaveRazorpayPaymentDto {
  @IsString()
  paymentId: string;

  @IsString()
  orderId: string;

  @IsString()
  signature: string;

  @IsOptional()
  @IsBoolean()
  setAsDefault?: boolean;
}
