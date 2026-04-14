import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { User } from '../../schemas/user/user.schema';
import { PaymentMethod } from '../../schemas/billing/payment-method.schema';
import { Discount } from '../../schemas/billing/discount.schema';
import { PaymentGatewayService } from '../payment-gateway/payment-gateway.service';
import { SubscriptionService } from '../subscription/subscription.service';
import {
  ConfirmStripePaymentDto,
  CreatePayPalPlanDto,
  ApprovePayPalDto,
  CreateRazorpayOrderDto,
  ConfirmRazorpayPaymentDto,
} from './dto/payment.dto';
import {
  convertCurrency,
  getCurrencyForCountry,
  convertToSmallestUnit,
} from '../../utils/currencyConverter';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(PaymentMethod.name)
    private paymentMethodModel: Model<PaymentMethod>,
    @InjectModel(Discount.name) private discountModel: Model<Discount>,
    private paymentGatewayService: PaymentGatewayService,
    private subscriptionService: SubscriptionService,
    private configService: ConfigService,
  ) {}

  /**
   * Create Stripe setup intent for payment method collection
   */
  async createStripeSetupIntent(userId: string): Promise<{
    clientSecret: string;
    customerId: string;
  }> {
    try {
      // Get user for customer creation
      const user = await this.userModel.findById(userId);
      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Create or get Stripe customer
      const customerResult = await this.paymentGatewayService.createCustomer(
        'stripe',
        {
          email: user.email,
          name: user.name || user.email,
          userId: userId.toString(),
        },
      );

      // Create setup intent using Stripe SDK
      const stripeGateway = this.paymentGatewayService.getStripeGateway();

      const setupIntent = await stripeGateway.setupIntents.create({
        customer: customerResult.customerId,
        payment_method_types: ['card'],
        usage: 'off_session', // For recurring payments
      });

      this.logger.log('Stripe setup intent created', {
        userId,
        customerId: customerResult.customerId,
        setupIntentId: setupIntent.id,
      });

      return {
        clientSecret: setupIntent.client_secret as string,
        customerId: customerResult.customerId,
      };
    } catch (error: any) {
      this.logger.error('Error creating Stripe setup intent', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Confirm Stripe payment and upgrade subscription
   */
  async confirmStripePayment(
    userId: string,
    dto: ConfirmStripePaymentDto,
  ): Promise<any> {
    try {
      const {
        setupIntentId,
        paymentMethodId,
        plan,
        billingInterval,
        discountCode,
      } = dto;

      if (!paymentMethodId || !plan) {
        throw new BadRequestException(
          'Payment method ID and plan are required',
        );
      }

      if (!['plus', 'pro', 'enterprise'].includes(plan)) {
        throw new BadRequestException('Invalid plan');
      }

      // Get user
      const user = await this.userModel.findById(userId);
      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Get Stripe gateway service
      const stripeGateway = this.paymentGatewayService.getStripeGateway();

      // Get payment method details first to check if it's already attached
      const paymentMethodDetails =
        await stripeGateway.paymentMethods.retrieve(paymentMethodId);

      // Get or create Stripe customer
      let gatewayCustomerId: string;
      const existingPaymentMethod = await this.paymentMethodModel.findOne({
        userId,
        gateway: 'stripe',
      });
      if (existingPaymentMethod) {
        gatewayCustomerId = existingPaymentMethod.gatewayCustomerId;
      } else {
        const customerResult = await this.paymentGatewayService.createCustomer(
          'stripe',
          {
            email: user.email,
            name: user.name || user.email,
            userId: userId.toString(),
          },
        );
        gatewayCustomerId = customerResult.customerId;
      }

      // Attach payment method to customer only if not already attached
      if (paymentMethodDetails.customer) {
        if (paymentMethodDetails.customer !== gatewayCustomerId) {
          this.logger.warn('Payment method attached to different customer', {
            userId,
            paymentMethodId,
            existingCustomer: paymentMethodDetails.customer,
            targetCustomer: gatewayCustomerId,
          });
        }
      } else {
        try {
          await stripeGateway.paymentMethods.attach(paymentMethodId, {
            customer: gatewayCustomerId,
          });
        } catch (attachError: any) {
          if (
            attachError.message &&
            attachError.message.includes('already been attached')
          ) {
            this.logger.log(
              'Payment method already attached (race condition)',
              {
                userId,
                paymentMethodId,
              },
            );
          } else {
            throw attachError;
          }
        }
      }

      if (setupIntentId) {
        this.logger.debug('Setup intent confirmed', {
          userId,
          setupIntentId,
        });
      }

      // Create or update payment method in database
      let paymentMethod: any = await this.paymentMethodModel.findOne({
        gateway: 'stripe',
        gatewayPaymentMethodId: paymentMethodId,
        userId,
      });

      if (!paymentMethod) {
        paymentMethod = new this.paymentMethodModel({
          userId,
          gateway: 'stripe',
          gatewayCustomerId,
          gatewayPaymentMethodId: paymentMethodId,
          type: 'card',
          card: {
            last4: (paymentMethodDetails.card?.last4 || '') as string,
            brand: (paymentMethodDetails.card?.brand || '') as string,
            expiryMonth: (paymentMethodDetails.card?.exp_month || 0) as number,
            expiryYear: (paymentMethodDetails.card?.exp_year || 0) as number,
            maskedNumber: `**** **** **** ${paymentMethodDetails.card?.last4 || ''}`,
          },
          isDefault: true,
          isActive: true,
          setupForRecurring: true,
          recurringStatus: 'active',
        });
        await paymentMethod.save();
      }

      // Set as default payment method
      await stripeGateway.customers.update(gatewayCustomerId, {
        invoice_settings: {
          default_payment_method: paymentMethodId,
        },
      });

      // Upgrade subscription
      const updatedSubscription =
        await this.subscriptionService.upgradeSubscription(
          userId,
          plan,
          'stripe',
          paymentMethod._id.toString(),
          {
            interval: billingInterval || 'monthly',
            discountCode,
          },
        );

      this.logger.log('Stripe payment confirmed and subscription upgraded', {
        userId,
        paymentMethodId,
        plan,
        subscriptionId: (updatedSubscription as any)._id?.toString(),
      });

      return {
        success: true,
        message:
          'Stripe payment confirmed and subscription upgraded successfully',
        data: updatedSubscription,
      };
    } catch (error: any) {
      this.logger.error('Error confirming Stripe payment', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Create PayPal subscription plan
   */
  async createPayPalPlan(
    userId: string,
    dto: CreatePayPalPlanDto,
  ): Promise<{
    planId: string;
    subscriptionId: string;
  }> {
    try {
      const {
        plan,
        billingInterval,
        amount,
        currency = 'USD',
        discountCode,
      } = dto;

      if (!plan || !billingInterval || !amount) {
        throw new BadRequestException(
          'Plan, billing interval, and amount are required',
        );
      }

      if (!['plus', 'pro', 'enterprise'].includes(plan)) {
        throw new BadRequestException('Invalid plan');
      }

      // Apply discount if provided
      let finalAmount = amount;
      if (discountCode) {
        try {
          const discountValidation =
            await this.subscriptionService.validateDiscountCode(
              discountCode,
              plan,
              amount,
            );
          finalAmount = discountValidation.finalAmount;
        } catch (discountError: any) {
          this.logger.warn(
            'Error applying discount code in PayPal plan creation',
            {
              userId,
              discountCode,
              error: discountError?.message,
            },
          );
          // Continue without discount if validation fails
        }
      }

      // Get user for email
      const user = await this.userModel.findById(userId);
      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Create PayPal customer
      const customerResult = await this.paymentGatewayService.createCustomer(
        'paypal',
        {
          email: user.email,
          name: user.name || user.email,
          userId: userId.toString(),
        },
      );

      // Create subscription in PayPal
      const paypalGateway = this.paymentGatewayService.getPayPalGateway();
      const subscriptionResult = await paypalGateway.createSubscription({
        customerId: customerResult.customerId,
        paymentMethodId: '',
        planId: `${plan}_${billingInterval}`,
        amount: finalAmount,
        currency: currency.toUpperCase(),
        interval: billingInterval,
        metadata: {
          userId: userId.toString(),
          plan,
          discountCode: discountCode || undefined,
        },
      });

      // Extract the plan ID from metadata (set by PayPal service)
      const planId =
        subscriptionResult.metadata?.planId ||
        subscriptionResult.subscriptionId;

      this.logger.log('PayPal plan created', {
        userId,
        plan,
        billingInterval,
        amount: finalAmount,
        planId,
      });

      return {
        planId,
        subscriptionId: subscriptionResult.subscriptionId,
      };
    } catch (error: any) {
      this.logger.error('Error creating PayPal plan', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Handle PayPal subscription approval and upgrade
   */
  async approvePayPalSubscription(
    userId: string,
    dto: ApprovePayPalDto,
  ): Promise<any> {
    try {
      const { subscriptionId, plan, billingInterval, discountCode } = dto;

      if (!subscriptionId) {
        throw new BadRequestException('PayPal subscription ID is required');
      }

      if (!plan || !['plus', 'pro', 'enterprise'].includes(plan)) {
        throw new BadRequestException('Invalid plan');
      }

      // Get PayPal subscription details
      const paypalGateway = this.paymentGatewayService.getPayPalGateway();
      const paypalSubscription =
        await paypalGateway.getSubscription(subscriptionId);

      if (!paypalSubscription) {
        throw new NotFoundException('PayPal subscription not found');
      }

      // Get user email for PayPal customer ID
      const user = await this.userModel.findById(userId);
      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Create or get PayPal customer
      const customerResult = await this.paymentGatewayService.createCustomer(
        'paypal',
        {
          email: user.email,
          name: user.name || user.email,
          userId: userId.toString(),
        },
      );

      // Create payment method from PayPal subscription
      const paymentMethodResult =
        await this.paymentGatewayService.createPaymentMethod('paypal', {
          type: 'paypal',
          customerId: customerResult.customerId,
          paypalEmail: user.email,
        });

      // Find or create payment method in database
      let paymentMethod: any = await this.paymentMethodModel.findOne({
        gateway: 'paypal',
        gatewayPaymentMethodId: paymentMethodResult.paymentMethodId,
        userId,
      });

      if (!paymentMethod) {
        paymentMethod = new this.paymentMethodModel({
          userId,
          gateway: 'paypal',
          gatewayCustomerId: customerResult.customerId,
          gatewayPaymentMethodId: subscriptionId, // Use subscription ID as payment method ID
          type: 'paypal_account',
          paypalAccount: {
            email: user.email,
          },
          isDefault: true,
          isActive: true,
          setupForRecurring: true,
          recurringStatus: 'active',
        });
        await paymentMethod.save();
      }

      // Upgrade subscription
      const updatedSubscription =
        await this.subscriptionService.upgradeSubscription(
          userId,
          plan,
          'paypal',
          paymentMethod._id.toString(),
          {
            interval: billingInterval || 'monthly',
            discountCode,
          },
        );

      // Update subscription with PayPal subscription ID
      (updatedSubscription as any).gatewaySubscriptionId = subscriptionId;
      await (updatedSubscription as any).save();

      this.logger.log(
        'PayPal subscription approved and subscription upgraded',
        {
          userId,
          paypalSubscriptionId: subscriptionId,
          plan,
          subscriptionId: (updatedSubscription as any)._id?.toString(),
        },
      );

      return {
        success: true,
        message:
          'PayPal subscription approved and subscription upgraded successfully',
        data: updatedSubscription,
      };
    } catch (error: any) {
      this.logger.error('Error approving PayPal subscription', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Create Razorpay order for subscription
   */
  async createRazorpayOrder(
    userId: string,
    dto: CreateRazorpayOrderDto,
  ): Promise<{
    orderId: string;
    amount: number;
    currency: string;
    keyId: string;
    country?: string;
    convertedAmount: number;
  }> {
    try {
      const { plan, billingInterval, amount, currency, country, discountCode } =
        dto;

      if (!plan || !billingInterval || !amount) {
        throw new BadRequestException(
          'Plan, billing interval, and amount are required',
        );
      }

      if (!['plus', 'pro', 'enterprise'].includes(plan)) {
        throw new BadRequestException('Invalid plan for upgrade');
      }

      // Get user
      const user = await this.userModel.findById(userId);
      if (!user) {
        throw new BadRequestException('User not found');
      }

      // Validate user email
      if (!user.email) {
        throw new BadRequestException(
          'User email is required to create a Razorpay order. Please update your profile with an email address.',
        );
      }

      // Check if Razorpay gateway is available
      if (!this.paymentGatewayService.isGatewayAvailable('razorpay')) {
        throw new InternalServerErrorException(
          'Razorpay payment gateway is not available. Please check your Razorpay configuration.',
        );
      }

      const razorpayGateway = this.paymentGatewayService.getRazorpayGateway();

      // Get or create Razorpay customer
      let gatewayCustomerId: string;
      const existingPaymentMethod = await this.paymentMethodModel.findOne({
        userId,
        gateway: 'razorpay',
      });
      if (existingPaymentMethod) {
        gatewayCustomerId = existingPaymentMethod.gatewayCustomerId;
      } else {
        try {
          const customerResult =
            await this.paymentGatewayService.createCustomer('razorpay', {
              email: user.email,
              name: user.name || user.email || 'Customer',
              userId: userId.toString(),
            });
          gatewayCustomerId = customerResult.customerId;
        } catch (customerError: any) {
          // Handle existing customer
          const errorMessage =
            customerError?.message ||
            customerError?.error?.description ||
            'Failed to create Razorpay customer';
          const isCustomerExistsError =
            errorMessage.includes('already exists') ||
            errorMessage.includes('Customer already exists') ||
            customerError?.statusCode === 400;

          if (isCustomerExistsError) {
            // Try to find existing customer by email
            const razorpayGatewayService = razorpayGateway;
            if (
              razorpayGatewayService &&
              typeof razorpayGatewayService.findCustomerByEmail === 'function'
            ) {
              const existingCustomerId =
                await razorpayGatewayService.findCustomerByEmail(user.email);
              if (existingCustomerId) {
                gatewayCustomerId = existingCustomerId;
                this.logger.log('Found existing Razorpay customer', {
                  userId,
                  userEmail: user.email,
                  customerId: existingCustomerId,
                });
              } else {
                throw customerError;
              }
            } else {
              throw customerError;
            }
          } else {
            this.logger.error('Failed to create Razorpay customer', {
              userId,
              userEmail: user.email,
              error: errorMessage,
            });
            throw customerError;
          }
        }
      }

      // Apply discount if provided
      let finalAmount = amount;
      if (discountCode) {
        try {
          const discountValidation =
            await this.subscriptionService.validateDiscountCode(
              discountCode,
              plan,
              amount,
            );
          finalAmount = discountValidation.finalAmount;
        } catch (discountError: any) {
          this.logger.warn('Error applying discount code in order creation', {
            userId,
            discountCode,
            error: discountError?.message,
          });
          // Continue without discount if validation fails
        }
      }

      // Determine currency based on country
      const orderCurrency = country
        ? getCurrencyForCountry(country)
        : (currency || 'USD').toUpperCase();

      // Convert amount if currency is different
      let orderAmount = finalAmount;
      if (currency && currency.toUpperCase() !== orderCurrency) {
        orderAmount = await convertCurrency(
          finalAmount,
          currency.toUpperCase(),
          orderCurrency,
        );
      }

      // Ensure minimum amount
      const MINIMUM_ORDER_AMOUNT = 1.0;
      if (orderAmount < MINIMUM_ORDER_AMOUNT) {
        throw new BadRequestException(
          `Order amount after discount (${orderCurrency} ${orderAmount.toFixed(2)}) is below the minimum required amount of ${orderCurrency} ${MINIMUM_ORDER_AMOUNT.toFixed(2)}. Please adjust your discount code.`,
        );
      }

      // Convert to smallest unit
      const amountInSmallestUnit = convertToSmallestUnit(
        orderAmount,
        orderCurrency,
      );

      const orderNotes: Record<string, any> = {
        userId: userId.toString(),
        plan,
        billingInterval,
        customerId: gatewayCustomerId,
        originalAmount: amount,
        finalAmount,
        originalCurrency: currency || 'USD',
      };

      if (country) {
        orderNotes.country = country;
      }

      if (discountCode) {
        orderNotes.discountCode = discountCode.toUpperCase().trim();
      }

      const order = await razorpayGateway.orders.create({
        amount: amountInSmallestUnit,
        currency: orderCurrency,
        receipt: `sub_${plan}_${billingInterval}_${Date.now()}`,
        notes: orderNotes,
      });

      this.logger.log('Razorpay order created', {
        userId,
        plan,
        billingInterval,
        amount: orderAmount,
        orderId: order.id,
      });

      return {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: this.configService.get<string>('RAZORPAY_KEY_ID') || '',
        country,
        convertedAmount: orderAmount,
      };
    } catch (error: any) {
      this.logger.error('Error creating Razorpay order', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Confirm Razorpay payment and upgrade subscription
   */
  async confirmRazorpayPayment(
    userId: string,
    dto: ConfirmRazorpayPaymentDto,
  ): Promise<any> {
    try {
      const {
        paymentId,
        orderId,
        signature,
        plan,
        billingInterval,
        discountCode,
      } = dto;

      if (!paymentId || !orderId || !signature || !plan) {
        throw new BadRequestException(
          'Payment ID, order ID, signature, and plan are required',
        );
      }

      if (!['plus', 'pro', 'enterprise'].includes(plan)) {
        throw new BadRequestException('Invalid plan for upgrade');
      }

      // Get user
      const user = await this.userModel.findById(userId);
      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Verify payment signature
      const razorpayGateway = this.paymentGatewayService.getRazorpayGateway();

      const crypto = require('crypto');
      const webhookSecret =
        this.configService.get<string>('RAZORPAY_KEY_SECRET') || '';
      const generatedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');

      if (generatedSignature !== signature) {
        throw new BadRequestException('Invalid payment signature');
      }

      // Fetch payment details from Razorpay
      const payment = await razorpayGateway.payments.fetch(paymentId);

      if (payment.status !== 'captured' && payment.status !== 'authorized') {
        throw new BadRequestException(
          `Payment not successful. Status: ${payment.status}`,
        );
      }

      // Get or create Razorpay customer
      let gatewayCustomerId: string;
      const existingPaymentMethod = await this.paymentMethodModel.findOne({
        userId,
        gateway: 'razorpay',
      });
      if (existingPaymentMethod) {
        gatewayCustomerId = existingPaymentMethod.gatewayCustomerId;
      } else {
        try {
          const customerResult =
            await this.paymentGatewayService.createCustomer('razorpay', {
              email: user.email,
              name: user.name || user.email || 'Customer',
              userId: userId.toString(),
            });
          gatewayCustomerId = customerResult.customerId;
        } catch (customerError: any) {
          // Handle existing customer
          const errorMessage =
            customerError?.message ||
            customerError?.error?.description ||
            'Failed to create Razorpay customer';
          const isCustomerExistsError =
            errorMessage.includes('already exists') ||
            errorMessage.includes('Customer already exists') ||
            customerError?.statusCode === 400;

          if (isCustomerExistsError) {
            const razorpayGatewayService = razorpayGateway;
            if (
              razorpayGatewayService &&
              typeof razorpayGatewayService.findCustomerByEmail === 'function'
            ) {
              const existingCustomerId =
                await razorpayGatewayService.findCustomerByEmail(user.email);
              if (existingCustomerId) {
                gatewayCustomerId = existingCustomerId;
                this.logger.log('Found existing Razorpay customer', {
                  userId,
                  userEmail: user.email,
                  customerId: existingCustomerId,
                });
              } else {
                throw customerError;
              }
            } else {
              throw customerError;
            }
          } else {
            throw customerError;
          }
        }
      }

      // Create or update payment method in database
      let paymentMethod = await this.paymentMethodModel.findOne({
        gateway: 'razorpay',
        gatewayPaymentMethodId: paymentId,
        userId,
      });

      if (!paymentMethod && payment.method) {
        const cardDetails = payment.card || {};
        paymentMethod = new this.paymentMethodModel({
          userId: userId,
          gateway: 'razorpay',
          gatewayCustomerId,
          gatewayPaymentMethodId: paymentId,
          type: payment.method === 'card' ? 'card' : payment.method,
          card:
            payment.method === 'card'
              ? {
                  last4: cardDetails.last4 || '',
                  brand: cardDetails.network || '',
                  expiryMonth: cardDetails.expiry_month || 0,
                  expiryYear: cardDetails.expiry_year || 0,
                  maskedNumber: `**** **** **** ${cardDetails.last4 || ''}`,
                }
              : undefined,
          isDefault: true,
          isActive: true,
          setupForRecurring: true,
          recurringStatus: 'active',
        });
        await paymentMethod.save();
      }

      // Upgrade subscription
      const paymentMethodId =
        paymentMethod && paymentMethod._id ? paymentMethod._id.toString() : '';
      const updatedSubscription =
        await this.subscriptionService.upgradeSubscription(
          userId,
          plan,
          'razorpay',
          paymentMethodId,
          {
            interval: billingInterval || 'monthly',
            discountCode,
          },
        );

      // Store the payment ID for reference
      if (paymentId && !(updatedSubscription as any).gatewaySubscriptionId) {
        (updatedSubscription as any).gatewaySubscriptionId = paymentId;
        await (updatedSubscription as any).save();
      }

      this.logger.log('Razorpay payment confirmed and subscription upgraded', {
        userId,
        paymentId,
        plan,
        subscriptionId: (updatedSubscription as any)._id?.toString(),
      });

      return {
        success: true,
        message:
          'Razorpay payment confirmed and subscription upgraded successfully',
        data: updatedSubscription,
      };
    } catch (error: any) {
      this.logger.error('Error confirming Razorpay payment', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }
}
