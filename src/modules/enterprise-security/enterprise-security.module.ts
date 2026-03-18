import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EnterpriseSecurityController } from './enterprise-security.controller';
import { EnterpriseSecurityService } from './enterprise-security.service';
import { User, UserSchema } from '../../schemas/user/user.schema';
import {
  ThreatLog,
  ThreatLogSchema,
} from '../../schemas/security/threat-log.schema';
import {
  AWSAuditLog,
  AWSAuditLogSchema,
} from '../../schemas/security/aws-audit-log.schema';
import {
  ComprehensiveAudit,
  ComprehensiveAuditSchema,
} from '../../schemas/security/comprehensive-audit.schema';
import {
  AIProviderAudit,
  AIProviderAuditSchema,
} from '../../schemas/security/ai-provider-audit.schema';
import {
  UserDataConsent,
  UserDataConsentSchema,
} from '../../schemas/security/user-data-consent.schema';
import {
  AuditAnchor,
  AuditAnchorSchema,
} from '../../schemas/security/audit-anchor.schema';
import { McpModule } from '../mcp/mcp.module';
import { AuditLoggerService } from '../../modules/aws/services/audit-logger.service';
import { BusinessEventLoggingService } from '../../common/services/business-event-logging.service';
import { ComprehensiveAuditService } from '../security/services/comprehensive-audit.service';
import { AIProviderAuditService } from '../security/services/ai-provider-audit.service';

@Module({
  imports: [
    McpModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: ThreatLog.name, schema: ThreatLogSchema },
      { name: AWSAuditLog.name, schema: AWSAuditLogSchema },
      { name: AuditAnchor.name, schema: AuditAnchorSchema },
      { name: ComprehensiveAudit.name, schema: ComprehensiveAuditSchema },
      { name: AIProviderAudit.name, schema: AIProviderAuditSchema },
      { name: UserDataConsent.name, schema: UserDataConsentSchema },
    ]),
  ],
  controllers: [EnterpriseSecurityController],
  providers: [
    EnterpriseSecurityService,
    AuditLoggerService,
    BusinessEventLoggingService,
    ComprehensiveAuditService,
    AIProviderAuditService,
  ],
  exports: [EnterpriseSecurityService],
})
export class EnterpriseSecurityModule {}
