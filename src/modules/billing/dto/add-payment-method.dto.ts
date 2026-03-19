import {
  IsIn,
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  ValidateNested,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * PCI DSS: Raw card data must NEVER be sent to the server.
 * For Stripe: use Stripe.js/Elements to create a PaymentMethod, then pass paymentMethodId.
 * For Razorpay: use Razorpay Checkout/Elements to tokenize, then pass razorpayTokenId.
 *
 * CardDetailsDto is deprecated for server-side use. Kept for validation fallback only.
 */
export class CardDetailsDto {
  @IsString()
  @IsNotEmpty()
  number: string;

  @IsNumber()
  expiryMonth: number;

  @IsNumber()
  expiryYear: number;

  @IsString()
  @IsNotEmpty()
  cvc: string;

  @IsString()
  @IsNotEmpty()
  name: string;
}

/**
 * UPI details for payment method
 */
export class UpiDetailsDto {
  @IsString()
  @IsNotEmpty()
  upiId: string;
}

/**
 * Bank account details for payment method
 */
export class BankAccountDetailsDto {
  @IsString()
  @IsNotEmpty()
  accountNumber: string;

  @IsString()
  @IsNotEmpty()
  ifsc: string;

  @IsString()
  @IsNotEmpty()
  bankName: string;
}

/**
 * Body DTO for add payment method endpoint.
 * POST api/billing/payment-methods
 *
 * For Stripe cards: pass paymentMethodId (pm_xxx) from Stripe.js createPaymentMethod().
 * For Razorpay cards: pass razorpayTokenId from Razorpay Checkout/Elements.
 * Raw card data (cardDetails) is rejected for PCI compliance.
 */
export class AddPaymentMethodDto {
  @IsIn(['stripe', 'razorpay', 'paypal'])
  gateway: 'stripe' | 'razorpay' | 'paypal';

  @IsIn(['card', 'upi', 'bank_account', 'paypal_account'])
  type: 'card' | 'upi' | 'bank_account' | 'paypal_account';

  /** Stripe: PaymentMethod ID (pm_xxx) from Stripe.js - required for card when gateway is stripe */
  @IsOptional()
  @IsString()
  paymentMethodId?: string;

  /** Razorpay: Token from Razorpay Checkout/Elements - required for card when gateway is razorpay */
  @IsOptional()
  @IsString()
  razorpayTokenId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpiDetailsDto)
  upiDetails?: UpiDetailsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => BankAccountDetailsDto)
  bankAccountDetails?: BankAccountDetailsDto;

  @IsOptional()
  @IsString()
  paypalEmail?: string;

  @IsOptional()
  @IsBoolean()
  setAsDefault?: boolean;
}
