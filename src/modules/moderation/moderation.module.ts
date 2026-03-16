import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ThreatLog,
  ThreatLogSchema,
} from '../../schemas/security/threat-log.schema';
import {
  ModerationConfig,
  ModerationConfigSchema,
} from '../../schemas/security/moderation-config.schema';
import {
  ModerationAppeal,
  ModerationAppealSchema,
} from '../../schemas/security/moderation-appeal.schema';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: ThreatLog.name, schema: ThreatLogSchema },
      { name: ModerationConfig.name, schema: ModerationConfigSchema },
      { name: ModerationAppeal.name, schema: ModerationAppealSchema },
    ]),
  ],
  controllers: [ModerationController],
  providers: [ModerationService],
  exports: [
    ModerationService,
    MongooseModule.forFeature([
      { name: ThreatLog.name, schema: ThreatLogSchema },
    ]),
  ],
})
export class ModerationModule {}
