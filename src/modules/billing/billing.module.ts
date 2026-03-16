import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { Invoice, InvoiceSchema } from '../../schemas/billing/invoice.schema';
import {
  PaymentMethod,
  PaymentMethodSchema,
} from '../../schemas/billing/payment-method.schema';
import { User, UserSchema } from '../../schemas/user/user.schema';
import {
  Discount,
  DiscountSchema,
} from '../../schemas/billing/discount.schema';
import { Team, TeamSchema } from '../../schemas/team-project/team.schema';
import {
  TeamMember,
  TeamMemberSchema,
} from '../../schemas/team-project/team-member.schema';
import { PaymentGatewayModule } from '../payment-gateway/payment-gateway.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { AuthModule } from '../auth/auth.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

/**
 * Billing Module (NestJS)
 *
 * Provides billing API: invoices, payment methods, Razorpay integration, gateway config.
 * Full parity with Express billing.controller and billing.routes.
 */
@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Invoice.name, schema: InvoiceSchema },
      { name: PaymentMethod.name, schema: PaymentMethodSchema },
      { name: User.name, schema: UserSchema },
      { name: Discount.name, schema: DiscountSchema },
      { name: Team.name, schema: TeamSchema },
      { name: TeamMember.name, schema: TeamMemberSchema },
    ]),
    PaymentGatewayModule,
    SubscriptionModule,
    AuthModule, // JwtService, User model, UserSessionService for JwtAuthGuard
  ],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
