import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../../schemas/user/user.schema';
import {
  UserSession,
  UserSessionSchema,
} from '../../schemas/user/user-session.schema';
import {
  MagicLinkToken,
  MagicLinkTokenSchema,
} from '../../schemas/user/magic-link-token.schema';
import { OnboardingService } from './onboarding.service';
import { OnboardingApiController } from './onboarding-api.controller';
import { MagicLinkController } from './magic-link.controller';
import { MagicLinkService } from './magic-link.service';
import { AuthModule } from '../auth/auth.module';
import { ProjectModule } from '../project/project.module';
import { CortexModule } from '../cortex/cortex.module';
import { UsageModule } from '../usage/usage.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: UserSession.name, schema: UserSessionSchema },
      { name: MagicLinkToken.name, schema: MagicLinkTokenSchema },
    ]),
    AuthModule,
    ProjectModule,
    CortexModule,
    UsageModule,
    EmailModule,
  ],
  controllers: [OnboardingApiController, MagicLinkController],
  providers: [OnboardingService, MagicLinkService],
  exports: [OnboardingService, MagicLinkService],
})
export class OnboardingModule {}
