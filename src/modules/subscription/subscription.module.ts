import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { SubscriptionNotificationService } from './subscription-notification.service';
import {
  Subscription,
  SubscriptionSchema,
} from '../../schemas/core/subscription.schema';
import { Invoice, InvoiceSchema } from '../../schemas/billing/invoice.schema';
import { Usage, UsageSchema } from '../../schemas/core/usage.schema';
import { User, UserSchema } from '../../schemas/user/user.schema';
import {
  PaymentMethod,
  PaymentMethodSchema,
} from '../../schemas/billing/payment-method.schema';
import {
  Discount,
  DiscountSchema,
} from '../../schemas/billing/discount.schema';
import {
  SubscriptionHistory,
  SubscriptionHistorySchema,
} from '../../schemas/billing/subscription-history.schema';
import { PaymentGatewayModule } from '../payment-gateway/payment-gateway.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    forwardRef(() => AuthModule),
    PaymentGatewayModule,
    EmailModule,
    MongooseModule.forFeature([
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Usage.name, schema: UsageSchema },
      { name: User.name, schema: UserSchema },
      { name: PaymentMethod.name, schema: PaymentMethodSchema },
      { name: Discount.name, schema: DiscountSchema },
      { name: SubscriptionHistory.name, schema: SubscriptionHistorySchema },
    ]),
  ],
  controllers: [SubscriptionController],
  providers: [SubscriptionService, SubscriptionNotificationService],
  exports: [SubscriptionService, SubscriptionNotificationService],
})
export class SubscriptionModule {}
