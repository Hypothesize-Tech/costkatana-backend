import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { User, UserSchema } from '../../schemas/user/user.schema';
import { Alert, AlertSchema } from '../../schemas/user/alert.schema';
import {
  UserModerationConfig,
  UserModerationConfigSchema,
} from '../../schemas/user/user-moderation-config.schema';
import {
  UserOptimizationConfig,
  UserOptimizationConfigSchema,
} from '../../schemas/user/user-optimization-config.schema';
import { Usage, UsageSchema } from '../../schemas/core/usage.schema';
import {
  Optimization,
  OptimizationSchema,
} from '../../schemas/core/optimization.schema';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { ActivityModule } from '../activity/activity.module';
import { AccountClosureModule } from '../account-closure/account-closure.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Alert.name, schema: AlertSchema },
      { name: UserModerationConfig.name, schema: UserModerationConfigSchema },
      {
        name: UserOptimizationConfig.name,
        schema: UserOptimizationConfigSchema,
      },
      { name: Usage.name, schema: UsageSchema },
      { name: Optimization.name, schema: OptimizationSchema },
    ]),
    AuthModule,
    EmailModule,
    SubscriptionModule,
    ActivityModule,
    AccountClosureModule,
    StorageModule,
  ],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
