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
 * Card details for payment method
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
 */
export class AddPaymentMethodDto {
  @IsIn(['stripe', 'razorpay', 'paypal'])
  gateway: 'stripe' | 'razorpay' | 'paypal';

  @IsIn(['card', 'upi', 'bank_account', 'paypal_account'])
  type: 'card' | 'upi' | 'bank_account' | 'paypal_account';

  @IsOptional()
  @ValidateNested()
  @Type(() => CardDetailsDto)
  cardDetails?: CardDetailsDto;

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
