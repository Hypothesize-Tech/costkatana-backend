import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Invoice } from '../../schemas/billing/invoice.schema';
import { PaymentMethod } from '../../schemas/billing/payment-method.schema';
import { Discount } from '../../schemas/billing/discount.schema';
import { User } from '../../schemas/user/user.schema';
import { Team, TeamDocument } from '../../schemas/team-project/team.schema';
import {
  TeamMember,
  TeamMemberDocument,
} from '../../schemas/team-project/team-member.schema';
import { SubscriptionService } from '../subscription/subscription.service';
import { PaymentGatewayService } from '../payment-gateway/payment-gateway.service';
import { ConfigService } from '@nestjs/config';
import { convertToSmallestUnit } from '../../utils/currencyConverter';
import { BusinessEventLoggingService } from '../../common/services/business-event-logging.service';
import * as crypto from 'crypto';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectModel(Invoice.name) private readonly invoiceModel: Model<Invoice>,
    @InjectModel(PaymentMethod.name)
    private readonly paymentMethodModel: Model<PaymentMethod>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Discount.name) private readonly discountModel: Model<Discount>,
    @InjectModel(Team.name) private readonly teamModel: Model<TeamDocument>,
    @InjectModel(TeamMember.name)
    private readonly teamMemberModel: Model<TeamMemberDocument>,
    private readonly subscriptionService: SubscriptionService,
    private readonly paymentGatewayService: PaymentGatewayService,
    private readonly configService: ConfigService,
    private readonly businessLogging: BusinessEventLoggingService,
  ) {}

  /**
   * Get invoices with pagination
   */
  async getInvoices(
    userId: string,
    limit: number = 10,
    offset: number = 0,
  ): Promise<{ invoices: Invoice[]; total: number }> {
    const invoices = await this.invoiceModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(offset)
      .populate('paymentMethodId')
      .exec();

    const total = await this.invoiceModel.countDocuments({ userId }).exec();

    return { invoices, total };
  }

  /**
   * Get single invoice
   */
  async getInvoice(userId: string, invoiceId: string): Promise<Invoice> {
    if (!invoiceId || invoiceId.trim() === '') {
      throw new BadRequestException('Invoice ID is required');
    }

    const invoice = await this.invoiceModel
      .findOne({ _id: invoiceId, userId })
      .populate('paymentMethodId')
      .exec();

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    return invoice;
  }

  /**
   * Get upcoming invoice preview
   */
  async getUpcomingInvoice(userId: string): Promise<{
    subscriptionId: string;
    periodStart: Date;
    periodEnd: Date;
    lineItems: Array<{
      description: string;
      quantity: number;
      unitPrice: number;
      total: number;
      type:
        | 'plan'
        | 'overage'
        | 'discount'
        | 'proration'
        | 'tax'
        | 'seat'
        | 'other';
    }>;
    subtotal: number;
    tax: number;
    total: number;
    currency: string;
    dueDate: Date;
  } | null> {
    const subscription =
      await this.subscriptionService.getSubscriptionByUserId(userId);

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    if (subscription.plan === 'free') {
      return null;
    }

    const pricing = this.subscriptionService.getPlanPricing(
      subscription.plan,
      subscription.billing?.interval || 'monthly',
    );

    const lineItems: Array<{
      description: string;
      quantity: number;
      unitPrice: number;
      total: number;
      type:
        | 'plan'
        | 'overage'
        | 'discount'
        | 'proration'
        | 'tax'
        | 'seat'
        | 'other';
    }> = [
      {
        description: `${subscription.plan.charAt(0).toUpperCase() + subscription.plan.slice(1)} Plan - ${
          subscription.billing?.interval || 'monthly'
        }`,
        quantity: 1,
        unitPrice: pricing.amount,
        total: pricing.amount,
        type: 'plan',
      },
    ];

    const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0);

    // Apply discount if applicable
    const applicableDiscount = await this.findApplicableDiscount(
      userId,
      subscription.plan,
    );
    if (applicableDiscount) {
      const discountAmount = this.calculateDiscountAmount(
        applicableDiscount,
        subtotal,
      );
      if (discountAmount > 0) {
        lineItems.push({
          description: `Discount: ${applicableDiscount.code}${applicableDiscount.description ? ` - ${applicableDiscount.description}` : ''}`,
          quantity: 1,
          unitPrice: -discountAmount, // Negative for discount
          total: -discountAmount,
          type: 'discount',
        });

        // Log discount application
        this.businessLogging.logEvent({
          event: 'discount_applied',
          category: 'billing',
          value: discountAmount,
          currency: 'USD',
          metadata: {
            discountCode: applicableDiscount.code,
            discountType: applicableDiscount.type,
            userId,
            plan: subscription.plan,
          },
        });
      }
    }

    const totalAfterDiscount = lineItems.reduce(
      (sum, item) => sum + item.total,
      0,
    );
    const tax = totalAfterDiscount * 0.1; // 10% tax
    const total = totalAfterDiscount + tax;

    const now = new Date();
    const periodEnd = new Date(now);
    if (subscription.billing?.interval === 'yearly') {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    return {
      subscriptionId: (subscription as any)._id.toString(),
      periodStart:
        subscription.billing?.nextBillingDate ||
        (subscription.usage as any)?.currentPeriodEnd ||
        now,
      periodEnd,
      lineItems,
      subtotal: totalAfterDiscount,
      tax,
      total,
      currency: subscription.billing?.currency || 'USD',
      dueDate:
        subscription.billing?.nextBillingDate ||
        (subscription.usage as any)?.currentPeriodEnd ||
        now,
    };
  }

  /**
   * Get payment methods
   */
  async getPaymentMethods(userId: string): Promise<PaymentMethod[]> {
    return this.paymentMethodModel
      .find({ userId, isActive: true })
      .sort({ isDefault: -1, createdAt: -1 })
      .exec();
  }

  /**
   * Add payment method
   */
  async addPaymentMethod(
    userId: string,
    dto: {
      gateway: 'stripe' | 'razorpay' | 'paypal';
      type: 'card' | 'upi' | 'bank_account' | 'paypal_account';
      paymentMethodId?: string;
      razorpayTokenId?: string;
      cardDetails?: {
        number: string;
        expiryMonth: number;
        expiryYear: number;
        cvc: string;
        name: string;
      };
      upiDetails?: { upiId: string };
      bankAccountDetails?: {
        accountNumber: string;
        ifsc: string;
        bankName: string;
      };
      paypalEmail?: string;
      setAsDefault?: boolean;
    },
  ): Promise<PaymentMethod> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Create or get gateway customer
    let gatewayCustomerId: string;
    const existingPaymentMethod = await this.paymentMethodModel
      .findOne({ userId, gateway: dto.gateway })
      .exec();

    if (existingPaymentMethod) {
      gatewayCustomerId = existingPaymentMethod.gatewayCustomerId;
    } else {
      const customerResult = await this.paymentGatewayService.createCustomer(
        dto.gateway,
        {
          email: user.email,
          name: user.name || user.email,
          userId: userId.toString(),
        },
      );
      gatewayCustomerId = customerResult.customerId;
    }

    const gatewayType =
      dto.type === 'paypal_account' ? 'paypal' : dto.type;

    const paymentMethodParams: Record<string, unknown> = {
      customerId: gatewayCustomerId,
      type: gatewayType,
    };

    if (dto.type === 'card') {
      if (dto.gateway === 'stripe' && dto.paymentMethodId) {
        paymentMethodParams.paymentMethodId = dto.paymentMethodId;
      } else if (dto.gateway === 'razorpay' && dto.razorpayTokenId) {
        paymentMethodParams.razorpayTokenId = dto.razorpayTokenId;
      } else if (dto.cardDetails) {
        throw new BadRequestException(
          'Raw card data cannot be sent to the server for PCI compliance. ' +
            'For Stripe: use Stripe.js to create a PaymentMethod and pass paymentMethodId. ' +
            'For Razorpay: use Razorpay Checkout/Elements to tokenize and pass razorpayTokenId.',
        );
      } else {
        throw new BadRequestException(
          dto.gateway === 'stripe'
            ? 'paymentMethodId is required for Stripe cards. Create it using Stripe.js on the client.'
            : 'razorpayTokenId is required for Razorpay cards. Create it using Razorpay Checkout/Elements on the client.',
        );
      }
    } else if (dto.type === 'upi' && dto.upiDetails) {
      paymentMethodParams.upiId = dto.upiDetails.upiId;
    } else if (dto.type === 'bank_account' && dto.bankAccountDetails) {
      paymentMethodParams.bankAccountNumber =
        dto.bankAccountDetails.accountNumber;
      paymentMethodParams.ifsc = dto.bankAccountDetails.ifsc;
      paymentMethodParams.bankName = dto.bankAccountDetails.bankName;
    } else if (dto.type === 'paypal_account' && dto.paypalEmail) {
      paymentMethodParams.paypalEmail = dto.paypalEmail;
    }

    const gatewayPaymentMethod =
      await this.paymentGatewayService.createPaymentMethod(
        dto.gateway,
        paymentMethodParams as {
          customerId: string;
          type: 'card' | 'upi' | 'bank_account' | 'paypal';
          paymentMethodId?: string;
          razorpayTokenId?: string;
          [key: string]: unknown;
        },
      );

    const gw = gatewayPaymentMethod as {
      paymentMethodId: string;
      type?: string;
      card?: unknown;
      upi?: unknown;
      bankAccount?: unknown;
      paypalAccount?: unknown;
    };

    // Attach to customer and set as default if needed (skip for PayPal)
    if (dto.gateway !== 'paypal') {
      const rawGateway = this.getRawGateway(dto.gateway);
      if (rawGateway.attachPaymentMethodToCustomer) {
        await rawGateway.attachPaymentMethodToCustomer(
          gatewayPaymentMethod.paymentMethodId,
          gatewayCustomerId,
        );
      }
    }

    if (dto.setAsDefault && dto.gateway !== 'paypal') {
      const rawGateway = this.getRawGateway(dto.gateway);
      if (rawGateway.setDefaultPaymentMethod) {
        await rawGateway.setDefaultPaymentMethod(
          gatewayCustomerId,
          gatewayPaymentMethod.paymentMethodId,
        );
      }
    }

    // Save payment method to database
    const paymentMethod = new this.paymentMethodModel({
      userId,
      gateway: dto.gateway,
      gatewayCustomerId,
      gatewayPaymentMethodId: gatewayPaymentMethod.paymentMethodId,
      type: gw.type ?? dto.type,
      card: gw.card,
      upi: gw.upi,
      bankAccount: gw.bankAccount,
      paypalAccount: gw.paypalAccount,
      isDefault: dto.setAsDefault || false,
      isActive: true,
      setupForRecurring: true,
      recurringStatus: 'active',
    });

    await paymentMethod.save();

    // If set as default, unset other defaults
    if (dto.setAsDefault) {
      await this.paymentMethodModel
        .updateMany(
          { userId, _id: { $ne: paymentMethod._id } },
          { $set: { isDefault: false } },
        )
        .exec();
    }

    return paymentMethod;
  }

  /**
   * Update payment method
   */
  async updatePaymentMethod(
    userId: string,
    paymentMethodId: string,
    dto: { setAsDefault?: boolean },
  ): Promise<PaymentMethod> {
    const paymentMethod = await this.paymentMethodModel
      .findOne({ _id: paymentMethodId, userId })
      .exec();

    if (!paymentMethod) {
      throw new NotFoundException('Payment method not found');
    }

    if (dto.setAsDefault !== undefined) {
      paymentMethod.isDefault = dto.setAsDefault;
      if (dto.setAsDefault) {
        // Unset other defaults
        await this.paymentMethodModel
          .updateMany(
            { userId, _id: { $ne: paymentMethod._id } },
            { $set: { isDefault: false } },
          )
          .exec();

        // Set as default in gateway (skip for PayPal)
        if (paymentMethod.gateway !== 'paypal') {
          const rawGateway = this.getRawGateway(paymentMethod.gateway);
          if (rawGateway.setDefaultPaymentMethod) {
            await rawGateway.setDefaultPaymentMethod(
              paymentMethod.gatewayCustomerId,
              paymentMethod.gatewayPaymentMethodId,
            );
          }
        }
      }
    }

    await paymentMethod.save();
    return paymentMethod;
  }

  /**
   * Remove payment method
   */
  async removePaymentMethod(
    userId: string,
    paymentMethodId: string,
  ): Promise<void> {
    const paymentMethod = await this.paymentMethodModel
      .findOne({ _id: paymentMethodId, userId })
      .exec();

    if (!paymentMethod) {
      throw new NotFoundException('Payment method not found');
    }

    // Check if it's the only payment method for active subscription
    const subscription =
      await this.subscriptionService.getSubscriptionByUserId(userId);
    if (
      subscription &&
      subscription.paymentMethodId?.toString() === paymentMethodId
    ) {
      throw new BadRequestException(
        'Cannot remove payment method that is currently in use. Please update your subscription first.',
      );
    }

    // Delete from payment gateway (swallow errors for gateways that don't support deletion)
    try {
      const rawGateway = this.getRawGateway(paymentMethod.gateway);
      if (rawGateway.deletePaymentMethod) {
        await rawGateway.deletePaymentMethod(
          paymentMethod.gatewayPaymentMethodId,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Payment method deletion in gateway failed (may not be supported): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // Mark as inactive instead of deleting (for audit trail)
    paymentMethod.isActive = false;
    paymentMethod.recurringStatus = 'cancelled';
    await paymentMethod.save();
  }

  /**
   * Create Razorpay order for payment method collection
   */
  async createRazorpayPaymentMethodOrder(
    userId: string,
    dto: { amount?: number; currency?: string },
  ): Promise<{
    orderId: string;
    keyId: string;
    amount: number;
    currency: string;
    convertedAmount: number;
  }> {
    const orderAmount = dto.amount || 1.0;
    const orderCurrency = (dto.currency || 'USD').toUpperCase();

    // Validate minimum amount
    if (orderAmount < 1.0) {
      throw new BadRequestException(
        `Order amount (${orderCurrency} ${orderAmount.toFixed(2)}) is below the minimum required amount of ${orderCurrency} 1.00.`,
      );
    }

    // Get user
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Validate user email (required for Razorpay customer creation)
    if (!user.email) {
      throw new BadRequestException(
        'User email is required. Please update your profile with an email address.',
      );
    }

    // Check if Razorpay gateway is available
    if (!this.paymentGatewayService.isGatewayAvailable('razorpay')) {
      throw new BadRequestException(
        'Razorpay payment gateway is not available',
      );
    }

    const razorpayGateway = this.paymentGatewayService.getRazorpayGateway();
    if (!razorpayGateway) {
      throw new BadRequestException('Razorpay SDK is not initialized');
    }

    // Get or create Razorpay customer (for future use, not required for order creation)
    let gatewayCustomerId: string;
    const existingPaymentMethod = await this.paymentMethodModel
      .findOne({ userId, gateway: 'razorpay' })
      .exec();

    if (existingPaymentMethod) {
      gatewayCustomerId = existingPaymentMethod.gatewayCustomerId;
    } else {
      // Create customer if it doesn't exist (for future payment method attachment)
      try {
        const customerResult = await this.paymentGatewayService.createCustomer(
          'razorpay',
          {
            email: user.email,
            name: user.name || user.email,
            userId: userId.toString(),
          },
        );
        gatewayCustomerId = customerResult.customerId;
      } catch (customerError) {
        // Log but don't fail - customer creation is not required for order creation
        this.logger.warn(
          'Failed to create Razorpay customer during order creation',
          {
            userId,
            error:
              customerError instanceof Error
                ? customerError.message
                : String(customerError),
          },
        );
      }
    }

    // Convert amount to smallest currency unit (cents for USD, paise for INR)
    const amountInSmallestUnit = convertToSmallestUnit(
      orderAmount,
      orderCurrency,
    );

    // Create Razorpay order
    // Receipt must be max 40 characters (Razorpay requirement)
    // Format: pm_<shortUserId>_<shortTimestamp>
    const shortUserId = userId.toString().substring(0, 12); // First 12 chars of userId
    const shortTimestamp = Date.now().toString().slice(-8); // Last 8 digits of timestamp
    const receipt = `pm_${shortUserId}_${shortTimestamp}`; // Max length: 3 + 12 + 1 + 8 = 24 chars

    let order;
    try {
      order = await razorpayGateway.orders.create({
        amount: amountInSmallestUnit,
        currency: orderCurrency,
        receipt,
        notes: {
          userId: userId.toString(),
          purpose: 'payment_method_collection',
        },
      });
    } catch (razorpayError: any) {
      this.logger.error('Razorpay order creation failed', {
        userId,
        amount: amountInSmallestUnit,
        currency: orderCurrency,
        error:
          razorpayError?.message ||
          razorpayError?.error?.description ||
          String(razorpayError),
      });
      throw new BadRequestException(
        razorpayError?.error?.description ||
          razorpayError?.message ||
          'Failed to create Razorpay order',
      );
    }

    this.logger.log('Razorpay order created for payment method collection', {
      userId,
      orderId: order.id,
      amount: orderAmount,
      currency: orderCurrency,
    });

    return {
      orderId: order.id,
      keyId: this.configService.get<string>('RAZORPAY_KEY_ID') || '',
      amount: amountInSmallestUnit,
      currency: orderCurrency,
      convertedAmount: orderAmount,
    };
  }

  /**
   * Save Razorpay payment method after successful checkout
   */
  async saveRazorpayPaymentMethod(
    userId: string,
    dto: {
      paymentId: string;
      orderId: string;
      signature: string;
      setAsDefault?: boolean;
    },
  ): Promise<PaymentMethod> {
    const { paymentId, orderId, signature, setAsDefault } = dto;

    // Get user
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const razorpayGateway = this.paymentGatewayService.getRazorpayGateway();
    if (!razorpayGateway) {
      throw new BadRequestException('Razorpay SDK is not initialized');
    }

    // Verify payment signature
    const text = `${orderId}|${paymentId}`;
    const secret = this.configService.get<string>('RAZORPAY_KEY_SECRET');
    if (!secret) {
      throw new BadRequestException('Razorpay secret not configured');
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(text)
      .digest('hex');

    if (expectedSignature !== signature) {
      throw new BadRequestException('Invalid payment signature');
    }

    // Fetch payment details from Razorpay
    const payment = await razorpayGateway.payments.fetch(paymentId);

    // Create or get Razorpay customer
    let gatewayCustomerId: string;
    const existingPaymentMethod = await this.paymentMethodModel
      .findOne({ userId, gateway: 'razorpay' })
      .exec();

    if (existingPaymentMethod) {
      gatewayCustomerId = existingPaymentMethod.gatewayCustomerId;
    } else {
      const customerResult = await this.paymentGatewayService.createCustomer(
        'razorpay',
        {
          email: user.email,
          name: user.name || user.email,
          userId: userId.toString(),
        },
      );
      gatewayCustomerId = customerResult.customerId;
    }

    // Extract payment method details from payment
    const paymentMethodType = payment.method || 'card';
    const paymentMethodData: any = {
      gateway: 'razorpay',
      gatewayCustomerId,
      gatewayPaymentMethodId: paymentId, // Use payment ID as payment method ID
      type: paymentMethodType,
      isDefault: setAsDefault || false,
      isActive: true,
      setupForRecurring: true,
      recurringStatus: 'active',
    };

    // Extract card details if available
    if (payment.card) {
      paymentMethodData.card = {
        last4: payment.card.last4 || '',
        brand:
          payment.card.network?.toLowerCase() ||
          payment.card.type?.toLowerCase() ||
          'unknown',
        expiryMonth: payment.card.expiry_month || null,
        expiryYear: payment.card.expiry_year || null,
        maskedNumber: `**** **** **** ${payment.card.last4 || ''}`,
      };
    }

    // Extract UPI details if available
    if (payment.vpa) {
      paymentMethodData.type = 'upi';
      paymentMethodData.upi = {
        upiId: payment.vpa,
        vpa: payment.vpa,
      };
    }

    // Check if payment method already exists
    let paymentMethod = await this.paymentMethodModel
      .findOne({
        userId,
        gateway: 'razorpay',
        gatewayPaymentMethodId: paymentId,
      })
      .exec();

    if (paymentMethod) {
      // Update existing payment method
      Object.assign(paymentMethod, paymentMethodData);
      await paymentMethod.save();
    } else {
      // Create new payment method
      paymentMethod = new this.paymentMethodModel({
        ...paymentMethodData,
        userId,
      });
      await paymentMethod.save();
    }

    // If set as default, unset other defaults
    if (setAsDefault) {
      await this.paymentMethodModel
        .updateMany(
          { userId, _id: { $ne: paymentMethod._id } },
          { $set: { isDefault: false } },
        )
        .exec();

      // Set as default in gateway if supported
      try {
        await razorpayGateway.setDefaultPaymentMethod(
          gatewayCustomerId,
          paymentId,
        );
      } catch (error) {
        // Razorpay may not support setting default payment method directly
        this.logger.warn('Failed to set default payment method in Razorpay', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return paymentMethod;
  }

  /**
   * Get payment gateway configuration (public keys only)
   */
  getPaymentConfig(): Record<string, any> {
    const config: Record<string, any> = {};

    // Return PayPal client ID (public key - safe to expose)
    const paypalClientId = this.configService.get<string>('PAYPAL_CLIENT_ID');
    const paypalMode = this.configService.get<string>('PAYPAL_MODE');
    if (paypalClientId) {
      config.paypal = {
        clientId: paypalClientId,
        mode: paypalMode || 'sandbox',
      };
    }

    // Return Stripe publishable key (public key - safe to expose)
    let stripePublishableKey = this.configService.get<string>(
      'STRIPE_PUBLISHABLE_KEY',
    );
    if (!stripePublishableKey) {
      // Extract publishable key pattern from secret key
      const stripeSecretKey =
        this.configService.get<string>('STRIPE_SECRET_KEY');
      if (stripeSecretKey) {
        if (stripeSecretKey.startsWith('sk_test_')) {
          stripePublishableKey = stripeSecretKey.replace(
            'sk_test_',
            'pk_test_',
          );
        } else if (stripeSecretKey.startsWith('sk_live_')) {
          stripePublishableKey = stripeSecretKey.replace(
            'sk_live_',
            'pk_live_',
          );
        }
        if (stripePublishableKey) {
          config.stripe = {
            publishableKey: stripePublishableKey,
            note: 'Publishable key derived from secret key pattern',
          };
        }
      }
    } else {
      config.stripe = {
        publishableKey: stripePublishableKey,
      };
    }

    // Return Razorpay key ID (public key - safe to expose)
    const razorpayKeyId = this.configService.get<string>('RAZORPAY_KEY_ID');
    if (razorpayKeyId) {
      config.razorpay = {
        keyId: razorpayKeyId,
      };
    }

    return config;
  }

  /**
   * Get raw gateway SDK instance
   */
  private getRawGateway(gateway: 'stripe' | 'razorpay' | 'paypal'): any {
    switch (gateway) {
      case 'stripe':
        return this.paymentGatewayService.getStripeGateway();
      case 'razorpay':
        return this.paymentGatewayService.getRazorpayGateway();
      case 'paypal':
        // PayPal doesn't have raw SDK access in the current implementation
        return {
          attachPaymentMethodToCustomer: async () => {},
          setDefaultPaymentMethod: async () => {},
          deletePaymentMethod: async () => {},
        };
      default:
        throw new BadRequestException(`Unsupported gateway: ${gateway}`);
    }
  }

  /**
   * Find applicable discount for a user and plan
   */
  private async findApplicableDiscount(
    userId: string,
    plan: string,
  ): Promise<Discount | null> {
    const now = new Date();

    // Find active discounts that are valid for the current time
    const baseQuery: any = {
      isActive: true,
      validFrom: { $lte: now },
      validUntil: { $gte: now },
    };

    // Check usage limits
    const usageQuery = {
      $or: [
        { maxUses: -1 }, // Unlimited uses
        { $expr: { $lt: ['$currentUses', '$maxUses'] } }, // Has remaining uses
      ],
    };

    // Check user applicability
    const userQuery = {
      $or: [
        { userId: null }, // General discount
        { userId: userId }, // User-specific discount
      ],
    };

    // Check plan applicability
    const planQuery = {
      $or: [
        { applicablePlans: { $exists: false } }, // No plan restriction
        { applicablePlans: { $size: 0 } }, // Empty plan array
        { applicablePlans: { $in: [plan] } }, // Specific plan
      ],
    };

    const query = {
      ...baseQuery,
      ...usageQuery,
      ...userQuery,
      ...planQuery,
    };

    const discount = await this.discountModel
      .findOne(query)
      .sort({ createdAt: -1 }) // Prefer newer discounts
      .exec();

    return discount;
  }

  /**
   * Calculate discount amount based on discount type
   */
  private calculateDiscountAmount(
    discount: Discount,
    subtotal: number,
  ): number {
    let discountAmount = 0;

    if (discount.type === 'percentage') {
      discountAmount = (subtotal * discount.amount) / 100;
    } else if (discount.type === 'fixed') {
      discountAmount = Math.min(discount.amount, subtotal); // Don't exceed subtotal
    }

    // Check minimum amount requirement
    if (discount.minAmount && subtotal < discount.minAmount) {
      return 0; // Discount doesn't apply if subtotal is below minimum
    }

    return Math.round(discountAmount * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Calculate total seats used in a team/workspace
   */
  async calculateSeatsUsed(teamId: string): Promise<number> {
    try {
      const activeMembers = await this.teamMemberModel.countDocuments({
        workspaceId: teamId,
        status: { $in: ['active', 'invited'] },
      });
      return activeMembers;
    } catch (error) {
      this.logger.error('Error calculating seats used', { error, teamId });
      throw error;
    }
  }

  /**
   * Get available seats in team/workspace
   */
  async getAvailableSeats(teamId: string): Promise<{
    total: number;
    used: number;
    available: number;
  }> {
    try {
      const team = await this.teamModel.findById(teamId);
      if (!team) {
        throw new NotFoundException('Team not found');
      }

      const totalSeats =
        team.billing.seatsIncluded + team.billing.additionalSeats;
      const usedSeats = await this.calculateSeatsUsed(teamId);
      const availableSeats = Math.max(0, totalSeats - usedSeats);

      return {
        total: totalSeats,
        used: usedSeats,
        available: availableSeats,
      };
    } catch (error) {
      this.logger.error('Error getting available seats', { error, teamId });
      throw error;
    }
  }

  /**
   * Check if team/workspace can add new members
   */
  async canAddMembers(teamId: string, count: number = 1): Promise<boolean> {
    try {
      const seats = await this.getAvailableSeats(teamId);
      return seats.available >= count;
    } catch (error) {
      this.logger.error('Error checking if can add members', {
        error,
        teamId,
        count,
      });
      return false;
    }
  }

  /**
   * Add additional seats to team/workspace
   */
  async addSeats(
    teamId: string,
    numberOfSeats: number,
    userId: string,
  ): Promise<void> {
    try {
      const team = await this.teamModel.findById(teamId);
      if (!team) {
        throw new NotFoundException('Team not found');
      }

      team.billing.additionalSeats += numberOfSeats;
      await team.save();

      // Calculate new billing amount
      const newMonthlyCost = this.calculateMonthlyCost(team.billing);

      this.logger.log('Additional seats added', {
        teamId,
        seatsAdded: numberOfSeats,
        totalSeats: team.billing.seatsIncluded + team.billing.additionalSeats,
        newMonthlyCost,
        userId,
      });

      // Charge for additional seats immediately
      await this.chargeForAdditionalSeats(team, numberOfSeats, userId);
    } catch (error) {
      this.logger.error('Error adding seats', { error, teamId, numberOfSeats });
      throw error;
    }
  }

  /**
   * Remove seats from team/workspace
   */
  async removeSeats(
    teamId: string,
    numberOfSeats: number,
    userId: string,
  ): Promise<void> {
    try {
      const team = await this.teamModel.findById(teamId);
      if (!team) {
        throw new NotFoundException('Team not found');
      }

      const usedSeats = await this.calculateSeatsUsed(teamId);
      const minRequiredSeats = Math.max(1, usedSeats); // At least 1 seat or current usage
      const newAdditionalSeats = Math.max(
        0,
        team.billing.additionalSeats - numberOfSeats,
      );
      const newTotalSeats = team.billing.seatsIncluded + newAdditionalSeats;

      if (newTotalSeats < minRequiredSeats) {
        throw new BadRequestException(
          `Cannot reduce seats below current usage (${usedSeats} members). Remove members first.`,
        );
      }

      team.billing.additionalSeats = newAdditionalSeats;
      await team.save();

      this.logger.log('Seats removed', {
        teamId,
        seatsRemoved: numberOfSeats,
        totalSeats: newTotalSeats,
        userId,
      });

      // Process refund or credit for removed seats
      await this.processSeatRemovalRefund(team, numberOfSeats, userId);
    } catch (error) {
      this.logger.error('Error removing seats', {
        error,
        teamId,
        numberOfSeats,
      });
      throw error;
    }
  }

  /**
   * Calculate monthly cost for team/workspace
   */
  calculateMonthlyCost(billing: {
    seatsIncluded: number;
    additionalSeats: number;
    pricePerSeat: number;
    billingCycle: 'monthly' | 'yearly';
  }): number {
    const additionalSeatsCost = billing.additionalSeats * billing.pricePerSeat;

    // Apply discount for yearly billing (e.g., 20% off)
    if (billing.billingCycle === 'yearly') {
      return additionalSeatsCost * 12 * 0.8; // 20% discount
    }

    return additionalSeatsCost;
  }

  /**
   * Get billing summary for team/workspace
   */
  async getBillingSummary(teamId: string): Promise<{
    seats: {
      included: number;
      additional: number;
      total: number;
      used: number;
      available: number;
    };
    costs: {
      pricePerSeat: number;
      additionalSeatsCost: number;
      totalMonthlyCost: number;
      billingCycle: 'monthly' | 'yearly';
    };
    nextBillingDate?: Date;
  }> {
    try {
      const team = await this.teamModel.findById(teamId);
      if (!team) {
        throw new NotFoundException('Team not found');
      }

      const seatsInfo = await this.getAvailableSeats(teamId);
      const monthlyCost = this.calculateMonthlyCost(team.billing);
      const additionalSeatsCost =
        team.billing.additionalSeats * team.billing.pricePerSeat;

      return {
        seats: {
          included: team.billing.seatsIncluded,
          additional: team.billing.additionalSeats,
          total: seatsInfo.total,
          used: seatsInfo.used,
          available: seatsInfo.available,
        },
        costs: {
          pricePerSeat: team.billing.pricePerSeat,
          additionalSeatsCost,
          totalMonthlyCost: monthlyCost,
          billingCycle: team.billing.billingCycle,
        },
      };
    } catch (error) {
      this.logger.error('Error getting billing summary', { error, teamId });
      throw error;
    }
  }

  /**
   * Prorate charges for mid-cycle seat additions
   */
  calculateProratedCharge(
    pricePerSeat: number,
    billingCycle: 'monthly' | 'yearly',
    daysRemaining: number,
  ): number {
    const daysInCycle = billingCycle === 'monthly' ? 30 : 365;
    const pricePerDay = pricePerSeat / daysInCycle;
    return pricePerDay * daysRemaining;
  }

  /**
   * Update team/workspace billing cycle
   */
  async updateBillingCycle(
    teamId: string,
    billingCycle: 'monthly' | 'yearly',
    userId: string,
  ): Promise<void> {
    try {
      const team = await this.teamModel.findById(teamId);
      if (!team) {
        throw new NotFoundException('Team not found');
      }

      team.billing.billingCycle = billingCycle;
      await team.save();

      this.logger.log('Billing cycle updated', {
        teamId,
        newBillingCycle: billingCycle,
        userId,
      });
    } catch (error) {
      this.logger.error('Error updating billing cycle', { error, teamId });
      throw error;
    }
  }

  /**
   * Check seat limits before adding member
   */
  async validateSeatAvailability(teamId: string): Promise<void> {
    const canAdd = await this.canAddMembers(teamId, 1);
    if (!canAdd) {
      const seats = await this.getAvailableSeats(teamId);
      throw new BadRequestException(
        `No available seats. Currently using ${seats.used} of ${seats.total} seats. Please upgrade your plan.`,
      );
    }
  }

  /**
   * Get team/workspace owner for billing purposes
   */
  async getTeamOwner(
    teamId: string,
  ): Promise<{ _id: string; email: string; name: string } | null> {
    try {
      const team = await this.teamModel
        .findById(teamId)
        .populate('ownerId', 'email name');
      if (!team) {
        throw new NotFoundException('Team not found');
      }
      const owner = team.ownerId as any;
      if (!owner) return null;
      return {
        _id: owner._id?.toString() || owner._id,
        email: owner.email,
        name: owner.name,
      };
    } catch (error) {
      this.logger.error('Error getting team owner', { error, teamId });
      throw error;
    }
  }

  /**
   * Charge for additional seats using the team's default payment method
   */
  private async chargeForAdditionalSeats(
    team: any,
    numberOfSeats: number,
    userId: string,
  ): Promise<void> {
    try {
      // Get team owner for billing
      const teamOwner = await this.getTeamOwner(team._id.toString());
      if (!teamOwner) {
        throw new BadRequestException('Team owner not found for billing');
      }

      // Get default payment method for the team owner
      const defaultPaymentMethod = await this.paymentMethodModel
        .findOne({ userId: teamOwner._id, isDefault: true, isActive: true })
        .exec();

      if (!defaultPaymentMethod) {
        throw new BadRequestException(
          'No default payment method found. Please add a payment method first.',
        );
      }

      // Calculate prorated charge for remaining days in billing cycle
      const now = new Date();
      const nextBillingDate =
        team.billing.nextBillingDate ||
        this.getNextBillingDate(now, team.billing.billingCycle);
      const daysRemaining = Math.max(
        1,
        Math.ceil(
          (nextBillingDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        ),
      );

      const proratedCharge =
        this.calculateProratedCharge(
          team.billing.pricePerSeat,
          team.billing.billingCycle,
          daysRemaining,
        ) * numberOfSeats;

      if (proratedCharge <= 0) {
        this.logger.warn(
          'Prorated charge is zero or negative, skipping payment',
          {
            teamId: team._id,
            numberOfSeats,
            daysRemaining,
            proratedCharge,
          },
        );
        return;
      }

      // Create invoice for the additional seats
      const invoice = new this.invoiceModel({
        userId: teamOwner._id,
        teamId: team._id,
        paymentMethodId: defaultPaymentMethod._id,
        amount: proratedCharge,
        currency: 'USD',
        status: 'pending',
        type: 'seat_addition',
        description: `Additional ${numberOfSeats} seat${numberOfSeats > 1 ? 's' : ''} for team "${team.name}"`,
        lineItems: [
          {
            description: `Additional seat${numberOfSeats > 1 ? 's' : ''} (${numberOfSeats}) - Prorated for ${daysRemaining} days`,
            quantity: numberOfSeats,
            unitPrice: proratedCharge / numberOfSeats,
            total: proratedCharge,
            type: 'seat',
          },
        ],
        metadata: {
          teamId: team._id,
          seatsAdded: numberOfSeats,
          proratedDays: daysRemaining,
          billingCycle: team.billing.billingCycle,
        },
      });

      await invoice.save();

      // Process payment immediately
      try {
        const paymentResult = await this.paymentGatewayService.charge(
          defaultPaymentMethod.gateway,
          {
            customerId: defaultPaymentMethod.gatewayCustomerId,
            paymentMethodId: defaultPaymentMethod.gatewayPaymentMethodId,
            amount: proratedCharge,
            currency: 'USD',
            description:
              invoice.description ?? invoice.lineItems?.[0]?.description,
            metadata: {
              teamId: team._id,
              userId,
              seatsAdded: numberOfSeats,
              invoiceId: invoice._id.toString(),
            },
          },
        );

        // Update invoice with payment result
        invoice.status = 'paid';
        invoice.paymentDate = new Date();
        invoice.gatewayTransactionId = paymentResult.transactionId;
        invoice.paymentGateway = defaultPaymentMethod.gateway;
        await invoice.save();

        this.businessLogging.logEvent({
          event: 'seat_charge_successful',
          category: 'billing',
          value: proratedCharge,
          currency: 'USD',
          metadata: {
            teamId: team._id,
            userId,
            seatsAdded: numberOfSeats,
            invoiceId: invoice._id,
            paymentId: paymentResult.transactionId,
          },
        });
      } catch (paymentError) {
        // Mark invoice as failed
        invoice.status = 'failed';
        invoice.failureReason =
          paymentError instanceof Error
            ? paymentError.message
            : 'Payment failed';
        await invoice.save();

        this.logger.error('Payment failed for additional seats', {
          error:
            paymentError instanceof Error
              ? paymentError.message
              : 'Unknown payment error',
          teamId: team._id,
          userId,
          numberOfSeats,
          amount: proratedCharge,
        });

        throw new BadRequestException(
          'Failed to charge for additional seats. Please check your payment method and try again.',
        );
      }
    } catch (error) {
      this.logger.error('Error charging for additional seats', {
        error: error instanceof Error ? error.message : 'Unknown error',
        teamId: team._id,
        userId,
        numberOfSeats,
      });
      throw error;
    }
  }

  /**
   * Process refund or credit for removed seats
   */
  private async processSeatRemovalRefund(
    team: any,
    numberOfSeats: number,
    userId: string,
  ): Promise<void> {
    try {
      // Calculate refund amount for remaining days in billing cycle
      const now = new Date();
      const nextBillingDate =
        team.billing.nextBillingDate ||
        this.getNextBillingDate(now, team.billing.billingCycle);
      const daysRemaining = Math.max(
        1,
        Math.ceil(
          (nextBillingDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        ),
      );

      const refundAmount =
        this.calculateProratedCharge(
          team.billing.pricePerSeat,
          team.billing.billingCycle,
          daysRemaining,
        ) * numberOfSeats;

      if (refundAmount <= 0) {
        this.logger.log('No refund needed for seat removal', {
          teamId: team._id,
          numberOfSeats,
          daysRemaining,
          refundAmount,
        });
        return;
      }

      // Get team owner for refund processing
      const teamOwner = await this.getTeamOwner(team._id.toString());
      if (!teamOwner) {
        throw new BadRequestException(
          'Team owner not found for refund processing',
        );
      }

      // Find the most recent seat addition invoice that can be refunded
      const recentSeatInvoice = await this.invoiceModel
        .findOne({
          userId: teamOwner._id,
          teamId: team._id,
          type: 'seat_addition',
          status: 'paid',
        })
        .sort({ createdAt: -1 })
        .exec();

      if (!recentSeatInvoice) {
        this.logger.warn('No recent seat addition invoice found for refund', {
          teamId: team._id,
          userId,
          numberOfSeats,
        });
        return;
      }

      // Process refund through payment gateway
      try {
        const refundResult = await this.paymentGatewayService.refund(
          recentSeatInvoice.paymentGateway || 'stripe',
          {
            transactionId: recentSeatInvoice.gatewayTransactionId!,
            amount: Math.min(refundAmount, recentSeatInvoice.total),
            reason: 'Seat removal refund',
            metadata: {
              teamId: team._id,
              userId,
              seatsRemoved: numberOfSeats,
              originalInvoiceId: recentSeatInvoice._id,
            },
          },
        );

        // Create credit invoice for the refund
        const creditInvoice = new this.invoiceModel({
          userId: teamOwner._id,
          teamId: team._id,
          amount: -refundResult.amount, // Negative for credit
          currency: 'USD',
          status: 'paid',
          type: 'seat_removal_credit',
          description: `Credit for ${numberOfSeats} removed seat${numberOfSeats > 1 ? 's' : ''} from team "${team.name}"`,
          lineItems: [
            {
              description: `Seat removal credit (${numberOfSeats}) - Prorated for ${daysRemaining} days`,
              quantity: numberOfSeats,
              unitPrice: -(refundResult.amount / numberOfSeats),
              total: -refundResult.amount,
              type: 'seat',
            },
          ],
          metadata: {
            teamId: team._id,
            seatsRemoved: numberOfSeats,
            proratedDays: daysRemaining,
            originalInvoiceId: recentSeatInvoice._id,
            refundId: refundResult.refundId,
          },
          paidAt: new Date(),
          paymentId: refundResult.refundId,
        });

        await creditInvoice.save();

        this.businessLogging.logEvent({
          event: 'seat_refund_successful',
          category: 'billing',
          value: refundResult.amount,
          currency: 'USD',
          metadata: {
            teamId: team._id,
            userId,
            seatsRemoved: numberOfSeats,
            originalInvoiceId: recentSeatInvoice._id,
            creditInvoiceId: creditInvoice._id,
            refundId: refundResult.refundId,
          },
        });
      } catch (refundError) {
        this.logger.error('Refund failed for removed seats', {
          error:
            refundError instanceof Error
              ? refundError.message
              : 'Unknown refund error',
          teamId: team._id,
          userId,
          numberOfSeats,
          refundAmount,
        });

        // Log the failed refund attempt but don't throw - seat removal should succeed even if refund fails
        this.businessLogging.logEvent({
          event: 'seat_refund_failed',
          category: 'billing',
          value: refundAmount,
          currency: 'USD',
          metadata: {
            teamId: team._id,
            userId,
            seatsRemoved: numberOfSeats,
            error:
              refundError instanceof Error
                ? refundError.message
                : 'Unknown error',
          },
        });
      }
    } catch (error) {
      this.logger.error('Error processing seat removal refund', {
        error: error instanceof Error ? error.message : 'Unknown error',
        teamId: team._id,
        userId,
        numberOfSeats,
      });
      // Don't throw - seat removal should succeed even if refund processing fails
    }
  }

  /**
   * Calculate next billing date based on cycle
   */
  private getNextBillingDate(
    currentDate: Date,
    billingCycle: 'monthly' | 'yearly',
  ): Date {
    const nextDate = new Date(currentDate);

    if (billingCycle === 'yearly') {
      nextDate.setFullYear(nextDate.getFullYear() + 1);
    } else {
      nextDate.setMonth(nextDate.getMonth() + 1);
    }

    return nextDate;
  }
}
