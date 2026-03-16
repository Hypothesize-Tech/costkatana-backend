import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

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

@Injectable()
export class ComplianceCheckService implements OnModuleInit {
  private readonly logger = new Logger(ComplianceCheckService.name);
  private readonly complianceRules = new Map<string, ComplianceRule>();
  private readonly complianceCache = new Map<string, ComplianceCheck>();
  private readonly MAX_CACHE_SIZE = 2000;

  constructor() {}

  onModuleInit() {
    this.initializeDefaultRules();
  }

  private initializeDefaultRules(): void {
    for (const template of DEFAULT_COMPLIANCE_RULES) {
      const id = `rule_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
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
    const id = `rule_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
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
}
