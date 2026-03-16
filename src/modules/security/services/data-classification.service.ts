import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

export interface ClassificationRule {
  id: string;
  name: string;
  description: string;
  patterns: RegExp[];
  category: 'public' | 'internal' | 'confidential' | 'restricted';
  complianceFrameworks: string[];
  riskScore: number;
  handling: {
    auditRequired: boolean;
    encryptionRequired: boolean;
    restrictedAccess: boolean;
    dataRetention: number; // days
  };
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface DataClassification {
  classification: {
    level: 'public' | 'internal' | 'confidential' | 'restricted';
    categories: string[];
    complianceFrameworks: string[];
    riskScore: number;
    confidence: number;
  };
  handling: {
    auditRequired: boolean;
    encryptionRequired: boolean;
    restrictedAccess: boolean;
    dataRetention: number;
  };
  metadata: {
    processedAt: number;
    processingTime: number;
    rulesApplied: string[];
    patternsMatched: number;
  };
}

const DEFAULT_CLASSIFICATION_RULES: Omit<
  ClassificationRule,
  'id' | 'createdAt' | 'updatedAt'
>[] = [
  {
    name: 'Personal Data',
    description: 'Personal identifiable information',
    patterns: [
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      /\b\d{3}-?\d{2}-?\d{4}\b/g, // SSN
      /\b\d{3}[-.()]?\d{3}[-.]\d{4}\b/g, // Phone
    ],
    category: 'confidential',
    complianceFrameworks: ['gdpr', 'ccpa'],
    riskScore: 0.8,
    handling: {
      auditRequired: true,
      encryptionRequired: true,
      restrictedAccess: true,
      dataRetention: 2555, // 7 years
    },
    enabled: true,
  },
  {
    name: 'Financial Data',
    description: 'Financial information and payment data',
    patterns: [
      /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, // Credit cards
      /\b\d{8,19}\b/g, // Account numbers
    ],
    category: 'restricted',
    complianceFrameworks: ['pci-dss', 'gdpr'],
    riskScore: 0.9,
    handling: {
      auditRequired: true,
      encryptionRequired: true,
      restrictedAccess: true,
      dataRetention: 2555,
    },
    enabled: true,
  },
  {
    name: 'Health Data',
    description: 'Medical and health information',
    patterns: [
      /\b(?:medical|health|diagnosis|treatment|medication)\b/gi,
      /\b\d{2}\/\d{2}\/\d{4}\b/g, // Dates that might be DOB
    ],
    category: 'restricted',
    complianceFrameworks: ['hipaa', 'gdpr'],
    riskScore: 0.95,
    handling: {
      auditRequired: true,
      encryptionRequired: true,
      restrictedAccess: true,
      dataRetention: 2555,
    },
    enabled: true,
  },
  {
    name: 'API Keys and Secrets',
    description: 'Authentication tokens and secrets',
    patterns: [
      /\b(?:sk-|pk_|api_key|secret_key|access_token)\s*[:=]\s*\S+/gi,
      /eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/g, // JWT
    ],
    category: 'restricted',
    complianceFrameworks: ['security'],
    riskScore: 1.0,
    handling: {
      auditRequired: true,
      encryptionRequired: true,
      restrictedAccess: true,
      dataRetention: 90, // 90 days
    },
    enabled: true,
  },
  {
    name: 'User Behavior Data',
    description: 'Analytics and usage patterns',
    patterns: [/\b(?:click|view|session|user_id|device_id)\b/gi],
    category: 'internal',
    complianceFrameworks: ['gdpr'],
    riskScore: 0.3,
    handling: {
      auditRequired: false,
      encryptionRequired: false,
      restrictedAccess: false,
      dataRetention: 1095, // 3 years
    },
    enabled: true,
  },
  {
    name: 'Public Content',
    description: 'General content without sensitive data',
    patterns: [],
    category: 'public',
    complianceFrameworks: [],
    riskScore: 0.1,
    handling: {
      auditRequired: false,
      encryptionRequired: false,
      restrictedAccess: false,
      dataRetention: 365, // 1 year
    },
    enabled: true,
  },
];

@Injectable()
export class DataClassificationService implements OnModuleInit {
  private readonly logger = new Logger(DataClassificationService.name);
  private readonly classificationRules = new Map<string, ClassificationRule>();
  private readonly classificationCache = new Map<string, DataClassification>();
  private readonly MAX_CACHE_SIZE = 5000;

  constructor() {}

  onModuleInit() {
    this.initializeDefaultRules();
  }

  private initializeDefaultRules(): void {
    for (const template of DEFAULT_CLASSIFICATION_RULES) {
      const id = `rule_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      this.classificationRules.set(id, {
        ...template,
        id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    this.logger.log(
      `Data classification service initialized with ${this.classificationRules.size} rules`,
    );
  }

  async classifyData(
    content: string,
    context?: { userId?: string; source?: string },
  ): Promise<DataClassification> {
    const startTime = Date.now();
    const cacheKey = this.generateCacheKey(content, context);

    const cached = this.classificationCache.get(cacheKey);
    if (cached) return cached;

    const patternsMatched: string[] = [];
    const rulesApplied: string[] = [];
    const categories = new Set<string>();
    const complianceFrameworks = new Set<string>();
    let maxRiskScore = 0;
    let confidence = 0;

    for (const rule of this.classificationRules.values()) {
      if (!rule.enabled) continue;

      let ruleMatches = 0;
      for (const pattern of rule.patterns) {
        const matches = content.match(pattern);
        if (matches) {
          ruleMatches += matches.length;
          patternsMatched.push(`${rule.name}:${matches.length}`);
        }
      }

      if (ruleMatches > 0) {
        rulesApplied.push(rule.id);
        categories.add(rule.category);
        rule.complianceFrameworks.forEach((f) => complianceFrameworks.add(f));
        maxRiskScore = Math.max(maxRiskScore, rule.riskScore);
        confidence = Math.min(confidence + ruleMatches * 0.1, 1.0);
      }
    }

    // Determine overall classification level
    const classificationLevel = this.determineOverallLevel(
      Array.from(categories),
      maxRiskScore,
    );

    // Aggregate handling requirements
    const handling = this.aggregateHandlingRequirements(Array.from(categories));

    const result: DataClassification = {
      classification: {
        level: classificationLevel,
        categories: Array.from(categories),
        complianceFrameworks: Array.from(complianceFrameworks),
        riskScore: maxRiskScore,
        confidence,
      },
      handling,
      metadata: {
        processedAt: Date.now(),
        processingTime: Date.now() - startTime,
        rulesApplied,
        patternsMatched: patternsMatched.length,
      },
    };

    // Cache result
    this.classificationCache.set(cacheKey, result);
    if (this.classificationCache.size > this.MAX_CACHE_SIZE) {
      const firstKey = this.classificationCache.keys().next().value;
      if (firstKey) this.classificationCache.delete(firstKey);
    }

    this.logger.debug('Data classified', {
      level: classificationLevel,
      riskScore: maxRiskScore,
      categories: Array.from(categories),
      processingTime: result.metadata.processingTime,
    });

    return result;
  }

  private determineOverallLevel(
    categories: string[],
    riskScore: number,
  ): 'public' | 'internal' | 'confidential' | 'restricted' {
    if (categories.includes('restricted') || riskScore >= 0.9)
      return 'restricted';
    if (categories.includes('confidential') || riskScore >= 0.7)
      return 'confidential';
    if (categories.includes('internal') || riskScore >= 0.3) return 'internal';
    return 'public';
  }

  private aggregateHandlingRequirements(
    categories: string[],
  ): DataClassification['handling'] {
    const requirements = {
      auditRequired: false,
      encryptionRequired: false,
      restrictedAccess: false,
      dataRetention: 365, // default 1 year
    };

    // Get the most restrictive handling for all applicable categories
    for (const category of categories) {
      const rule = Array.from(this.classificationRules.values()).find(
        (r) => r.category === category,
      );
      if (rule) {
        requirements.auditRequired =
          requirements.auditRequired || rule.handling.auditRequired;
        requirements.encryptionRequired =
          requirements.encryptionRequired || rule.handling.encryptionRequired;
        requirements.restrictedAccess =
          requirements.restrictedAccess || rule.handling.restrictedAccess;
        requirements.dataRetention = Math.max(
          requirements.dataRetention,
          rule.handling.dataRetention,
        );
      }
    }

    return requirements;
  }

  private generateCacheKey(
    content: string,
    context?: { userId?: string; source?: string },
  ): string {
    const crypto = require('crypto');
    const key = `${content}:${context?.userId ?? ''}:${context?.source ?? ''}`;
    return crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
  }

  getRules(): ClassificationRule[] {
    return Array.from(this.classificationRules.values());
  }

  updateRule(id: string, updates: Partial<ClassificationRule>): boolean {
    const rule = this.classificationRules.get(id);
    if (!rule) return false;

    this.classificationRules.set(id, {
      ...rule,
      ...updates,
      updatedAt: Date.now(),
    });
    return true;
  }

  addRule(
    rule: Omit<ClassificationRule, 'id' | 'createdAt' | 'updatedAt'>,
  ): string {
    const id = `rule_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    this.classificationRules.set(id, {
      ...rule,
      id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return id;
  }

  removeRule(id: string): boolean {
    return this.classificationRules.delete(id);
  }

  clearCache(): void {
    this.classificationCache.clear();
  }
}
