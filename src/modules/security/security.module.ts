import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CommonModule } from '../../common/common.module';
import {
  ThreatLog,
  ThreatLogSchema,
} from '../../schemas/security/threat-log.schema';
import {
  TraceSpan,
  TraceSpanSchema,
} from '../../schemas/trace/trace-span.schema';
import {
  AIProviderAudit,
  AIProviderAuditSchema,
} from '../../schemas/security/ai-provider-audit.schema';
import {
  UserDataConsent,
  UserDataConsentSchema,
} from '../../schemas/security/user-data-consent.schema';
import {
  ComprehensiveAudit,
  ComprehensiveAuditSchema,
} from '../../schemas/security/comprehensive-audit.schema';
import {
  SecurityAlert,
  SecurityAlertSchema,
} from '../../schemas/security/security-alert.schema';
import {
  UserFirewallConfig,
  UserFirewallConfigSchema,
} from '../../schemas/security/user-firewall-config.schema';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { IntegrationModule } from '../integration/integration.module';
import { HtmlSecurityService } from './html-security.service';
import { PromptFirewallService } from './prompt-firewall.service';
import { LlmSecurityService } from './llm-security.service';
import { PreTransmissionFilterService } from './services/pre-transmission-filter.service';
import { AIProviderAuditService } from './services/ai-provider-audit.service';
import { ComprehensiveAuditService } from './services/comprehensive-audit.service';
import { DataClassificationService } from './services/data-classification.service';
import { ComplianceCheckService } from './services/compliance-check.service';
import { RealTimeMonitoringService } from './services/real-time-monitoring.service';
import { SecurityController } from './security.controller';

@Module({
  imports: [
    forwardRef(() => CommonModule),
    AuthModule,
    EmailModule,
    forwardRef(() => IntegrationModule),
    MongooseModule.forFeature([
      { name: ThreatLog.name, schema: ThreatLogSchema },
      { name: TraceSpan.name, schema: TraceSpanSchema },
      { name: AIProviderAudit.name, schema: AIProviderAuditSchema },
      { name: UserDataConsent.name, schema: UserDataConsentSchema },
      { name: ComprehensiveAudit.name, schema: ComprehensiveAuditSchema },
      { name: SecurityAlert.name, schema: SecurityAlertSchema },
      {
        name: UserFirewallConfig.name,
        schema: UserFirewallConfigSchema,
      },
    ]),
  ],
  controllers: [SecurityController],
  providers: [
    HtmlSecurityService,
    PromptFirewallService,
    LlmSecurityService,
    PreTransmissionFilterService,
    AIProviderAuditService,
    ComprehensiveAuditService,
    DataClassificationService,
    ComplianceCheckService,
    RealTimeMonitoringService,
  ],
  exports: [
    MongooseModule,
    LlmSecurityService,
    PromptFirewallService,
    HtmlSecurityService,
    PreTransmissionFilterService,
    AIProviderAuditService,
    ComprehensiveAuditService,
    DataClassificationService,
    ComplianceCheckService,
    RealTimeMonitoringService,
  ],
})
export class SecurityModule {}
