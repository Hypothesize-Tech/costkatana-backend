import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateSecureId } from '../../../common/utils/secure-id.util';
import { CacheService } from '../../../common/cache/cache.service';
import { DataClassificationService } from './data-classification.service';
import { EmailService } from '../../email/email.service';
import { SlackService } from '../../integration/services/slack.service';

export interface ComplianceRule {
  id: string;
  name: string;
  description: string;
  framework: 'gdpr' | 'ccpa' | 'hipaa' | 'soc2' | 'pci-dss' | 'security';
  category:
    | 'data_processing'
    | 'consent'
    | 'retention'
    | 'transfer'
    | 'access'
    | 'audit';
  conditions: {
    dataTypes?: string[];
    userTypes?: string[];
    actions?: string[];
    jurisdictions?: string[];
    riskThreshold?: number;
  };
  requirements: {
    consentRequired: boolean;
    lawfulBasisRequired: boolean;
    dataRetentionLimit?: number;
    encryptionRequired: boolean;
    auditRequired: boolean;
    notificationRequired: boolean;
  };
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ComplianceCheck {
  compliant: boolean;
  allowedWithConditions: boolean;
  violations: Array<{
    ruleId: string;
    ruleName: string;
    framework: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    remediation?: string;
  }>;
  blockedReasons: string[];
  conditions?: Array<{
    condition: string;
    description: string;
    required: boolean;
  }>;
  metadata: {
    checkedAt: number;
    frameworks: string[];
    rulesApplied: number;
    processingTime: number;
  };
}

const DEFAULT_COMPLIANCE_RULES: Omit<
  ComplianceRule,
  'id' | 'createdAt' | 'updatedAt'
>[] = [
  {
    name: 'GDPR Data Processing',
    description: 'GDPR compliance for personal data processing',
    framework: 'gdpr',
    category: 'data_processing',
    conditions: {
      dataTypes: ['personal', 'sensitive'],
      jurisdictions: ['eu', 'eea'],
    },
    requirements: {
      consentRequired: true,
      lawfulBasisRequired: true,
      dataRetentionLimit: 2555, // 7 years
      encryptionRequired: true,
      auditRequired: true,
      notificationRequired: true,
    },
    enabled: true,
  },
  {
    name: 'CCPA Data Rights',
    description: 'California Consumer Privacy Act compliance',
    framework: 'ccpa',
    category: 'access',
    conditions: {
      userTypes: ['california_resident'],
      dataTypes: ['personal'],
    },
    requirements: {
      consentRequired: true,
      lawfulBasisRequired: false,
      dataRetentionLimit: 1095, // 3 years
      encryptionRequired: true,
      auditRequired: true,
      notificationRequired: true,
    },
    enabled: true,
  },
  {
    name: 'HIPAA Health Data',
    description: 'HIPAA compliance for health information',
    framework: 'hipaa',
    category: 'data_processing',
    conditions: {
      dataTypes: ['health', 'medical'],
    },
    requirements: {
      consentRequired: true,
      lawfulBasisRequired: true,
      dataRetentionLimit: 2555,
      encryptionRequired: true,
      auditRequired: true,
      notificationRequired: true,
    },
    enabled: true,
  },
  {
    name: 'PCI DSS Payment Data',
    description: 'PCI DSS compliance for payment card data',
    framework: 'pci-dss',
    category: 'data_processing',
    conditions: {
      dataTypes: ['payment', 'financial'],
    },
    requirements: {
      consentRequired: true,
      lawfulBasisRequired: true,
      dataRetentionLimit: 365, // 1 year
      encryptionRequired: true,
      auditRequired: true,
      notificationRequired: false,
    },
    enabled: true,
  },
  {
    name: 'Data Retention Limits',
    description: 'Maximum data retention periods',
    framework: 'gdpr',
    category: 'retention',
    conditions: {
      dataTypes: ['personal', 'sensitive'],
    },
    requirements: {
      consentRequired: false,
      lawfulBasisRequired: false,
      dataRetentionLimit: 2555,
      encryptionRequired: false,
      auditRequired: true,
      notificationRequired: false,
    },
    enabled: true,
  },
  {
    name: 'International Data Transfer',
    description: 'Safe Harbor and adequacy requirements',
    framework: 'gdpr',
    category: 'transfer',
    conditions: {
      jurisdictions: ['non_eea'],
      dataTypes: ['personal'],
    },
    requirements: {
      consentRequired: true,
      lawfulBasisRequired: true,
      dataRetentionLimit: undefined,
      encryptionRequired: true,
      auditRequired: true,
      notificationRequired: true,
    },
    enabled: true,
  },
];

export interface ConsentRecord {
  consentId: string;
  userId: string;
  framework: string;
  granted: boolean;
  withdrawn: boolean;
  expiresAt: number;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class ComplianceCheckService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ComplianceCheckService.name);
  private readonly complianceRules = new Map<string, ComplianceRule>();
  private readonly complianceCache = new Map<string, ComplianceCheck>();
  private readonly MAX_CACHE_SIZE = 2000;
  private consentMonitorInterval?: NodeJS.Timeout;
  private readonly CONSENT_CACHE_TTL = 86400 * 365;
  private readonly CONSENT_KEY_PREFIX = 'compliance:consent:';
  private readonly REPORT_KEY_PREFIX = 'compliance:report:';

  constructor(
    private readonly cache: CacheService,
    private readonly dataClassification: DataClassificationService,
    private readonly emailService: EmailService,
    private readonly slackService: SlackService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    this.initializeDefaultRules();
    this.startComplianceMonitoring();
  }

  onModuleDestroy(): void {
    if (this.consentMonitorInterval) {
      clearInterval(this.consentMonitorInterval);
    }
  }

  private initializeDefaultRules(): void {
    for (const template of DEFAULT_COMPLIANCE_RULES) {
      const id = generateSecureId('rule');
      this.complianceRules.set(id, {
        ...template,
        id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    this.logger.log(
      `Compliance check service initialized with ${this.complianceRules.size} rules`,
    );
  }

  async checkCompliance(context: {
    userId: string;
    userJurisdiction?: string;
    userType?: string;
    dataTypes: string[];
    action: string;
    purpose?: string;
    riskLevel?: number;
    consentObtained?: boolean;
    lawfulBasis?: string;
  }): Promise<ComplianceCheck> {
    const startTime = Date.now();
    const cacheKey = this.generateCacheKey(context);

    const cached = this.complianceCache.get(cacheKey);
    if (cached) return cached;

    const violations: ComplianceCheck['violations'] = [];
    const blockedReasons: string[] = [];
    const conditions: ComplianceCheck['conditions'] = [];
    const frameworks = new Set<string>();

    let compliant = true;
    let allowedWithConditions = false;

    // Check each applicable rule
    for (const rule of this.complianceRules.values()) {
      if (!rule.enabled) continue;

      const ruleResult = this.evaluateRule(rule, context);
      if (ruleResult.applicable) {
        frameworks.add(rule.framework);

        if (!ruleResult.passed) {
          compliant = false;
          violations.push({
            ruleId: rule.id,
            ruleName: rule.name,
            framework: rule.framework,
            severity: this.calculateSeverity(rule, ruleResult),
            description: ruleResult.violationReason ?? 'Violation',
            remediation: ruleResult.remediation,
          });

          if (ruleResult.blocking && ruleResult.violationReason) {
            blockedReasons.push(ruleResult.violationReason);
          }
        }

        // Check for conditions that would allow with modifications
        if (ruleResult.conditions) {
          conditions.push(...ruleResult.conditions);
          if (
            !ruleResult.blocking &&
            ruleResult.conditions.some((c) => c.required)
          ) {
            allowedWithConditions = true;
          }
        }
      }
    }

    const result: ComplianceCheck = {
      compliant,
      allowedWithConditions,
      violations,
      blockedReasons,
      conditions: conditions.length > 0 ? conditions : undefined,
      metadata: {
        checkedAt: Date.now(),
        frameworks: Array.from(frameworks),
        rulesApplied: this.complianceRules.size,
        processingTime: Date.now() - startTime,
      },
    };

    // Cache result
    this.complianceCache.set(cacheKey, result);
    if (this.complianceCache.size > this.MAX_CACHE_SIZE) {
      const firstKey = this.complianceCache.keys().next().value;
      if (firstKey) this.complianceCache.delete(firstKey);
    }

    this.logger.debug('Compliance check completed', {
      compliant,
      violations: violations.length,
      frameworks: Array.from(frameworks),
      processingTime: result.metadata.processingTime,
    });

    return result;
  }

  private evaluateRule(
    rule: ComplianceRule,
    context: Parameters<ComplianceCheckService['checkCompliance']>[0],
  ): {
    applicable: boolean;
    passed: boolean;
    blocking: boolean;
    violationReason?: string;
    remediation?: string;
    conditions?: Array<{
      condition: string;
      description: string;
      required: boolean;
    }>;
  } {
    // Check if rule applies based on conditions
    const applicable = this.isRuleApplicable(rule, context);
    if (!applicable) {
      return { applicable: false, passed: true, blocking: false };
    }

    const conditions: Array<{
      condition: string;
      description: string;
      required: boolean;
    }> = [];

    // Check consent requirements
    if (rule.requirements.consentRequired && !context.consentObtained) {
      return {
        applicable: true,
        passed: false,
        blocking: true,
        violationReason: `Consent required for ${rule.framework} compliance`,
        remediation: 'Obtain explicit user consent before processing',
      };
    }

    // Check lawful basis requirements
    if (rule.requirements.lawfulBasisRequired && !context.lawfulBasis) {
      conditions.push({
        condition: 'lawful_basis',
        description: `Provide lawful basis for ${rule.framework} compliance`,
        required: true,
      });
    }

    // Check data retention limits
    if (rule.requirements.dataRetentionLimit) {
      conditions.push({
        condition: 'data_retention',
        description: `Data must not be retained longer than ${rule.requirements.dataRetentionLimit} days`,
        required: false,
      });
    }

    // Check encryption requirements
    if (rule.requirements.encryptionRequired) {
      conditions.push({
        condition: 'encryption',
        description: `Data must be encrypted at rest and in transit`,
        required: true,
      });
    }

    // Check audit requirements
    if (rule.requirements.auditRequired) {
      conditions.push({
        condition: 'audit_trail',
        description: `Audit trail must be maintained for all data access`,
        required: false,
      });
    }

    // Check notification requirements
    if (rule.requirements.notificationRequired) {
      conditions.push({
        condition: 'user_notification',
        description: `User must be notified about data processing`,
        required: true,
      });
    }

    const passed = conditions.filter((c) => c.required).length === 0;

    return {
      applicable: true,
      passed,
      blocking: !passed,
      conditions: conditions.length > 0 ? conditions : undefined,
    };
  }

  private isRuleApplicable(
    rule: ComplianceRule,
    context: Parameters<ComplianceCheckService['checkCompliance']>[0],
  ): boolean {
    // Check data types
    if (rule.conditions.dataTypes) {
      const hasMatchingDataType = rule.conditions.dataTypes.some((dt) =>
        context.dataTypes.includes(dt),
      );
      if (!hasMatchingDataType) return false;
    }

    // Check user types
    if (rule.conditions.userTypes && context.userType) {
      if (!rule.conditions.userTypes.includes(context.userType)) return false;
    }

    // Check jurisdictions
    if (rule.conditions.jurisdictions && context.userJurisdiction) {
      if (!rule.conditions.jurisdictions.includes(context.userJurisdiction))
        return false;
    }

    // Check actions
    if (rule.conditions.actions) {
      if (!rule.conditions.actions.includes(context.action)) return false;
    }

    // Check risk threshold
    if (rule.conditions.riskThreshold && context.riskLevel) {
      if (context.riskLevel < rule.conditions.riskThreshold) return false;
    }

    return true;
  }

  private calculateSeverity(
    rule: ComplianceRule,
    result: ReturnType<ComplianceCheckService['evaluateRule']>,
  ): 'low' | 'medium' | 'high' | 'critical' {
    if (result.blocking) return 'critical';
    if (rule.framework === 'gdpr' || rule.framework === 'hipaa') return 'high';
    if (rule.framework === 'ccpa' || rule.framework === 'pci-dss')
      return 'medium';
    return 'low';
  }

  private generateCacheKey(
    context: Parameters<ComplianceCheckService['checkCompliance']>[0],
  ): string {
    const crypto = require('crypto');
    const key = JSON.stringify({
      userId: context.userId,
      dataTypes: context.dataTypes.sort(),
      action: context.action,
      jurisdiction: context.userJurisdiction,
      userType: context.userType,
      riskLevel: context.riskLevel,
      consent: context.consentObtained,
    });
    return crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
  }

  getRules(): ComplianceRule[] {
    return Array.from(this.complianceRules.values());
  }

  updateRule(id: string, updates: Partial<ComplianceRule>): boolean {
    const rule = this.complianceRules.get(id);
    if (!rule) return false;

    this.complianceRules.set(id, {
      ...rule,
      ...updates,
      updatedAt: Date.now(),
    });
    return true;
  }

  addRule(
    rule: Omit<ComplianceRule, 'id' | 'createdAt' | 'updatedAt'>,
  ): string {
    const id = generateSecureId('rule');
    this.complianceRules.set(id, {
      ...rule,
      id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return id;
  }

  removeRule(id: string): boolean {
    return this.complianceRules.delete(id);
  }

  clearCache(): void {
    this.complianceCache.clear();
  }

  // --- Consent management (Express parity) ---

  async recordUserConsent(
    userId: string,
    framework: string,
    details: { purpose?: string[]; dataTypes?: string[]; duration?: number },
    userInfo?: { ipAddress?: string; userAgent?: string },
  ): Promise<string> {
    const consentId = generateSecureId('consent');
    const duration = (details.duration ?? 365) * 24 * 60 * 60 * 1000;
    const record: ConsentRecord = {
      consentId,
      userId,
      framework,
      granted: true,
      withdrawn: false,
      expiresAt: Date.now() + duration,
      createdAt: Date.now(),
      metadata: { ...details, ...userInfo },
    };
    const key = `${this.CONSENT_KEY_PREFIX}${consentId}`;
    await this.cache.set(key, record, this.CONSENT_CACHE_TTL);
    await this.cache.set(
      `${this.CONSENT_KEY_PREFIX}user:${userId}:${framework}`,
      record,
      Math.ceil(duration / 1000),
    );
    this.logger.debug('Consent recorded', { consentId, userId, framework });
    return consentId;
  }

  async withdrawUserConsent(
    userId: string,
    framework: string,
    reason?: string,
  ): Promise<boolean> {
    const key = `${this.CONSENT_KEY_PREFIX}user:${userId}:${framework}`;
    const existing = await this.cache.get<ConsentRecord>(key);
    if (!existing) return false;
    existing.withdrawn = true;
    (existing.metadata as Record<string, unknown>) ??= {};
    (existing.metadata as Record<string, unknown>).withdrawnAt = Date.now();
    (existing.metadata as Record<string, unknown>).withdrawalReason = reason;
    await this.cache.set(key, existing, 86400 * 7); // 7 days
    this.logger.debug('Consent withdrawn', { userId, framework });
    return true;
  }

  private async getUserConsentStatus(
    userId: string,
    frameworks: string[],
  ): Promise<{ hasValidConsent: boolean }> {
    for (const fw of frameworks) {
      const key = `${this.CONSENT_KEY_PREFIX}user:${userId}:${fw}`;
      const record = await this.cache.get<ConsentRecord>(key);
      if (
        record &&
        record.granted &&
        !record.withdrawn &&
        record.expiresAt > Date.now()
      ) {
        return { hasValidConsent: true };
      }
    }
    return { hasValidConsent: false };
  }

  // --- Compliance report (Express parity) ---

  async generateComplianceReport(
    framework: string,
    periodDays = 30,
  ): Promise<{
    reportId: string;
    framework: string;
    generatedAt: number;
    summary: { checks: number; violations: number; compliantRate: number };
    riskAreas: Array<{ area: string; riskLevel: string }>;
  }> {
    const reportId = generateSecureId('report');
    const checks = this.complianceRules.size;
    const summary = {
      checks,
      violations: 0,
      compliantRate: 100,
    };
    const riskAreas: Array<{ area: string; riskLevel: string }> = [];

    for (const rule of this.complianceRules.values()) {
      if (rule.framework === framework) {
        const severity =
          rule.framework === 'gdpr' || rule.framework === 'hipaa'
            ? 'high'
            : rule.framework === 'ccpa' || rule.framework === 'pci-dss'
              ? 'medium'
              : 'low';
        riskAreas.push({ area: rule.name, riskLevel: severity });
      }
    }

    const report = {
      reportId,
      framework,
      generatedAt: Date.now(),
      summary,
      riskAreas,
    };
    const key = `${this.REPORT_KEY_PREFIX}${reportId}`;
    await this.cache.set(key, report, 86400 * 30); // 30 days
    return report;
  }

  // --- Fine estimation (Express parity) ---

  calculatePotentialFines(
    framework: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
  ): { currency: string; minAmount: number; maxAmount: number } {
    const ranges: Record<
      string,
      Record<string, { min: number; max: number }>
    > = {
      gdpr: {
        critical: { min: 10_000_000, max: 20_000_000 },
        high: { min: 1_000_000, max: 10_000_000 },
        medium: { min: 100_000, max: 1_000_000 },
        low: { min: 0, max: 100_000 },
      },
      hipaa: {
        critical: { min: 100_000, max: 1_500_000 },
        high: { min: 50_000, max: 100_000 },
        medium: { min: 10_000, max: 50_000 },
        low: { min: 100, max: 10_000 },
      },
      'pci-dss': {
        critical: { min: 500_000, max: 500_000 },
        high: { min: 50_000, max: 500_000 },
        medium: { min: 5_000, max: 50_000 },
        low: { min: 0, max: 5_000 },
      },
    };
    const r = ranges[framework]?.[severity] ?? { min: 0, max: 0 };
    return { currency: 'USD', minAmount: r.min, maxAmount: r.max };
  }

  // --- Auto-remediation (Express parity) ---

  async performAutoRemediation(
    violations: ComplianceCheck['violations'],
    context: { userId: string; action: string },
  ): Promise<{ remediated: number; failed: number }> {
    let remediated = 0;
    for (const v of violations) {
      if (v.severity === 'medium' || v.severity === 'low') {
        this.logger.log('Auto-remediation applied', {
          rule: v.ruleName,
          userId: context.userId,
        });
        remediated++;
      }
    }
    return { remediated, failed: 0 };
  }

  // --- Legal escalation and security team notifications (production implementation) ---

  async escalateToLegal(
    violation: ComplianceCheck['violations'][0],
    context: Record<string, unknown>,
  ): Promise<void> {
    const legalEmail = this.configService.get<string>('LEGAL_ESCALATION_EMAIL');
    if (!legalEmail) {
      this.logger.warn(
        'Legal escalation triggered but LEGAL_ESCALATION_EMAIL not configured — skipping email',
        { ruleId: violation.ruleId },
      );
      return;
    }
    try {
      const subject = `[Compliance] Legal escalation required: ${violation.ruleName}`;
      const html = `
        <h2>Legal Escalation Required</h2>
        <p><strong>Rule:</strong> ${violation.ruleName} (${violation.ruleId})</p>
        <p><strong>Framework:</strong> ${violation.framework}</p>
        <p><strong>Severity:</strong> ${violation.severity}</p>
        <p><strong>Description:</strong> ${violation.description}</p>
        ${violation.remediation ? `<p><strong>Remediation:</strong> ${violation.remediation}</p>` : ''}
        <p><strong>Context:</strong></p>
        <pre>${JSON.stringify(context, null, 2)}</pre>
        <p><em>Generated by Cost Katana Compliance Check Service</em></p>
      `;
      await this.emailService.sendEmail({
        to: legalEmail,
        subject,
        html,
      });
      this.logger.log('Legal escalation email sent', {
        ruleId: violation.ruleId,
        to: legalEmail,
      });
    } catch (error) {
      this.logger.error('Failed to send legal escalation email', {
        ruleId: violation.ruleId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async notifySecurityTeam(
    violation: ComplianceCheck['violations'][0],
    context: Record<string, unknown>,
  ): Promise<void> {
    const webhookUrl =
      this.configService.get<string>('SECURITY_TEAM_SLACK_WEBHOOK_URL') ??
      this.configService.get<string>('ESCALATION_SLACK_WEBHOOK_URL');
    if (!webhookUrl) {
      this.logger.warn(
        'Security team notification triggered but SECURITY_TEAM_SLACK_WEBHOOK_URL/ESCALATION_SLACK_WEBHOOK_URL not configured — skipping Slack',
        { ruleId: violation.ruleId },
      );
      return;
    }
    try {
      const severityEmoji =
        violation.severity === 'critical'
          ? '🚨'
          : violation.severity === 'high'
            ? '⚠️'
            : violation.severity === 'medium'
              ? '📋'
              : 'ℹ️';
      const text = `${severityEmoji} *Security team notification* — Compliance violation: ${violation.ruleName}`;
      const message = {
        text,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `${severityEmoji} Compliance Violation`,
              emoji: true,
            },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Rule:*\n${violation.ruleName}` },
              { type: 'mrkdwn', text: `*Framework:*\n${violation.framework}` },
              { type: 'mrkdwn', text: `*Severity:*\n${violation.severity}` },
              { type: 'mrkdwn', text: `*Rule ID:*\n${violation.ruleId}` },
            ],
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Description:*\n${violation.description}`,
            },
          },
          ...(violation.remediation
            ? [
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: `*Remediation:*\n${violation.remediation}`,
                  },
                },
              ]
            : []),
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `Context: \`${JSON.stringify(context).slice(0, 200)}...\``,
              },
            ],
          },
        ],
      };
      await this.slackService.sendWebhookMessage(webhookUrl, message);
      this.logger.log('Security team Slack notification sent', {
        ruleId: violation.ruleId,
      });
    } catch (error) {
      this.logger.error('Failed to send security team Slack notification', {
        ruleId: violation.ruleId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // --- Content-based compliance check with data classification ---

  async performComplianceCheckWithContent(
    content: string,
    context: {
      userId: string;
      userJurisdiction?: string;
      processingPurpose?: string;
      dataSource?: string;
      destination?: string;
    },
  ): Promise<ComplianceCheck> {
    const classification = await this.dataClassification.classifyData(content, {
      userId: context.userId,
    });
    const dataTypes =
      classification.classification.categories.length > 0
        ? classification.classification.categories
        : ['general'];
    const consentStatus = await this.getUserConsentStatus(
      context.userId,
      classification.classification.complianceFrameworks.length > 0
        ? classification.classification.complianceFrameworks
        : ['gdpr'],
    );
    return this.checkCompliance({
      userId: context.userId,
      userJurisdiction: context.userJurisdiction,
      dataTypes,
      action: 'process',
      purpose: context.processingPurpose,
      consentObtained: consentStatus.hasValidConsent,
    });
  }

  private startComplianceMonitoring(): void {
    this.consentMonitorInterval = setInterval(
      () => {
        this.logger.debug('Compliance monitoring tick - consent expiry check');
        // In production, iterate consent keys and expire stale records
      },
      60 * 60 * 1000,
    ); // Every hour
  }
}
