import { IsOptional, IsBoolean } from 'class-validator';

/**
 * Body DTO for update payment method endpoint.
 * PUT api/billing/payment-methods/:paymentMethodId
 */
export class UpdatePaymentMethodDto {
  @IsOptional()
  @IsBoolean()
  setAsDefault?: boolean;
}
