import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { PredictiveIntelligenceModule } from '@/modules/predictive-intelligence/predictive-intelligence.module';
import { UserSessionModule } from '@/modules/user-session/user-session.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { User, UserSchema } from '@/schemas/user/user.schema';
import { PerformanceCostAnalysisController } from './performance-cost-analysis.controller';

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: 3600 },
      }),
      inject: [ConfigService],
    }),
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    UserSessionModule,
    PredictiveIntelligenceModule,
    AuthModule,
  ],
  controllers: [PerformanceCostAnalysisController],
})
export class PerformanceCostAnalysisModule {}
