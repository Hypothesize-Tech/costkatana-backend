import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { BackupCodesService } from './backup-codes.service';
import { AuthController } from './auth.controller';
import { MfaController } from './mfa.controller';
import { BackupCodesController } from './backup-codes.controller';
import { AuthMfaTokenGuard } from './guards/auth-mfa-token.guard';
import { MfaRateLimitGuard } from './guards/mfa-rate-limit.guard';
import { User, UserSchema } from '../../schemas/user/user.schema';
import {
  UserSession,
  UserSessionSchema,
} from '../../schemas/user/user-session.schema';
import {
  TeamMember,
  TeamMemberSchema,
} from '../../schemas/team-project/team-member.schema';
import { EmailModule } from '../email/email.module';
import { UserSessionModule } from '../user-session/user-session.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { TeamModule } from '../team/team.module';
import { ActivityModule } from '../activity/activity.module';
import { AccountClosureModule } from '../account-closure/account-closure.module';

@Module({
  imports: [
    ConfigModule,
    EmailModule,
    UserSessionModule,
    forwardRef(() => SubscriptionModule),
    forwardRef(() => TeamModule),
    ActivityModule,
    AccountClosureModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: UserSession.name, schema: UserSessionSchema },
      { name: TeamMember.name, schema: TeamMemberSchema },
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: 3600, // 1 hour in seconds
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController, MfaController, BackupCodesController],
  providers: [
    AuthService,
    MfaService,
    BackupCodesService,
    AuthMfaTokenGuard,
    MfaRateLimitGuard,
  ],
  exports: [
    AuthService,
    JwtModule,
    MfaService,
    BackupCodesService,
    AuthMfaTokenGuard,
    MfaRateLimitGuard,
    MongooseModule,
    UserSessionModule,
  ],
})
export class AuthModule {}
