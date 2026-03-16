import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { User, UserSchema } from '../../schemas/user/user.schema';
import {
  PaymentMethod,
  PaymentMethodSchema,
} from '../../schemas/billing/payment-method.schema';
import {
  Discount,
  DiscountSchema,
} from '../../schemas/billing/discount.schema';
import { PaymentGatewayModule } from '../payment-gateway/payment-gateway.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    ConfigModule,
    PaymentGatewayModule,
    SubscriptionModule,
    AuthModule, // JwtService, User model, UserSessionService for JwtAuthGuard
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: PaymentMethod.name, schema: PaymentMethodSchema },
      { name: Discount.name, schema: DiscountSchema },
    ]),
  ],
  controllers: [PaymentController],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
