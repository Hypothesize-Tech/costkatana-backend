import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentGatewayModule } from '../payment-gateway/payment-gateway.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { PaymentWebhookController } from './payment-webhook.controller';
import { PaymentWebhookService } from './payment-webhook.service';
import { Invoice, InvoiceSchema } from '../../schemas/billing/invoice.schema';
import {
  Subscription,
  SubscriptionSchema,
} from '../../schemas/core/subscription.schema';
import {
  PaymentMethod,
  PaymentMethodSchema,
} from '../../schemas/billing/payment-method.schema';
import { User, UserSchema } from '../../schemas/user/user.schema';
import {
  SubscriptionHistory,
  SubscriptionHistorySchema,
} from '../../schemas/billing/subscription-history.schema';

@Module({
  imports: [
    PaymentGatewayModule,
    SubscriptionModule,
    MongooseModule.forFeature([
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: PaymentMethod.name, schema: PaymentMethodSchema },
      { name: User.name, schema: UserSchema },
      { name: SubscriptionHistory.name, schema: SubscriptionHistorySchema },
    ]),
  ],
  controllers: [PaymentWebhookController],
  providers: [PaymentWebhookService],
})
export class PaymentWebhookModule {}
