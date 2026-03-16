import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Discount,
  DiscountSchema,
} from '../../schemas/billing/discount.schema';
import {
  Subscription,
  SubscriptionSchema,
} from '../../schemas/core/subscription.schema';
import { User, UserSchema } from '../../schemas/user/user.schema';
import { AuthModule } from '../auth/auth.module';
import { CommonModule } from '../../common/common.module';
import { AdminDiscountController } from './admin-discount.controller';
import { AdminDiscountService } from './admin-discount.service';
import { DiscountUsageService } from './discount-usage.service';

@Module({
  imports: [
    CommonModule,
    AuthModule,
    MongooseModule.forFeature([
      { name: Discount.name, schema: DiscountSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [AdminDiscountController],
  providers: [AdminDiscountService, DiscountUsageService],
  exports: [AdminDiscountService, DiscountUsageService],
})
export class AdminDiscountModule {}
