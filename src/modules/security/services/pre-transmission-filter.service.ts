/**
 * Pre-Transmission Filter Service (NestJS)
 *
 * Port from Express preTransmissionFilter.service.ts.
 * Prevents sensitive data (PII, secrets) from reaching external AI services.
 * Provides filterContent, getStatistics, and getRecentAlerts.
 */

import { Injectable, Logger } from '@nestjs/common';

export interface FilterRule {
  id: string;
  name: string;
  description: string;
  pattern: RegExp;
  category: 'pii' | 'sensitive' | 'confidential' | 'compliance';
  severity: 'low' | 'medium' | 'high' | 'critical';
  action: 'log' | 'redact' | 'block' | 'alert';
  replacement?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Detection {
  ruleId: string;
  ruleName: string;
  category: string;
  severity: string;
  pattern: string;
  matches: Array<{
    text: string;
    position: number;
    length: number;
    context: string;
  }>;
  action: string;
  applied: boolean;
}

export interface FilterResult {
  allowed: boolean;
  modified: boolean;
  originalText: string;
  filteredText: string;
  detections: Detection[];
  riskScore: number;
  blockedReason?: string;
  timestamp: number;
  metadata: {
    processingTime: number;
    rulesApplied: string[];
    redactionCount: number;
    blockingRules: string[];
  };
}

export interface FilterStatistics {
  totalRequests: number;
  filteredRequests: number;
  blockedRequests: number;
  redactedRequests: number;
  piiDetections: number;
  riskDistribution: Record<string, number>;
  categoryDistribution: Record<string, number>;
  topDetectedPatterns: Array<{ pattern: string; count: number }>;
  averageProcessingTime: number;
  uptime: number;
}

export interface FilterContext {
  userId: string;
  provider?: string;
  model?: string;
  endpoint?: string;
  userTier?: string;
}

const DEFAULT_RULES: Omit<FilterRule, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'Email Addresses',
    description: 'Detect and redact email addresses',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    category: 'pii',
    severity: 'high',
    action: 'redact',
    replacement: '[EMAIL_REDACTED]',
    enabled: true,
  },
  {
    name: 'Social Security Numbers',
    description: 'Detect and block SSNs',
    pattern: /\b\d{3}-?\d{2}-?\d{4}\b/g,
    category: 'pii',
    severity: 'critical',
    action: 'block',
    enabled: true,
  },
  {
    name: 'Credit Card Numbers',
    description: 'Detect and block credit card numbers',
    pattern: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g,
    category: 'pii',
    severity: 'critical',
    action: 'block',
    enabled: true,
  },
  {
    name: 'Phone Numbers',
    description: 'Detect and redact phone numbers',
    pattern: /\b\d{3}[-.()]?\d{3}[-.]\d{4}\b/g,
    category: 'pii',
    severity: 'medium',
    action: 'redact',
    replacement: '[PHONE_REDACTED]',
    enabled: true,
  },
  {
    name: 'JWT Tokens',
    description: 'Detect and block JWT tokens',
    pattern: /eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/g,
    category: 'sensitive',
    severity: 'critical',
    action: 'block',
    enabled: true,
  },
  {
    name: 'IP Addresses',
    description: 'Detect and redact IP addresses',
    pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    category: 'pii',
    severity: 'medium',
    action: 'redact',
    replacement: '[IP_REDACTED]',
    enabled: true,
  },
  {
    name: 'Passwords',
    description: 'Detect and block password fields',
    pattern: /\b(?:password|passwd|pwd)\s*[:=]\s*\S+/gi,
    category: 'confidential',
    severity: 'critical',
    action: 'block',
    enabled: true,
  },
  {
    name: 'Secrets and Keys',
    description: 'Detect and block secret keys',
    pattern: /\b(?:secret|key|token)\s*[:=]\s*\S+/gi,
    category: 'confidential',
    severity: 'critical',
    action: 'block',
    enabled: true,
  },
];

@Injectable()
export class PreTransmissionFilterService {
  private readonly logger = new Logger(PreTransmissionFilterService.name);
  private readonly filterRules = new Map<string, FilterRule>();
  private readonly detectionCache = new Map<string, FilterResult>();
  private readonly recentAlerts: Array<{
    id: string;
    timestamp: number;
    rule: string;
    severity: string;
    context?: FilterContext;
  }> = [];
  private readonly MAX_CACHE_SIZE = 10000;
  private readonly MAX_RECENT_ALERTS = 500;
  private filterStats: FilterStatistics = {
    totalRequests: 0,
    filteredRequests: 0,
    blockedRequests: 0,
    redactedRequests: 0,
    piiDetections: 0,
    riskDistribution: { low: 0, medium: 0, high: 0, critical: 0 },
    categoryDistribution: {
      pii: 0,
      sensitive: 0,
      confidential: 0,
      compliance: 0,
    },
    topDetectedPatterns: [],
    averageProcessingTime: 0,
    uptime: Date.now(),
  };
  private readonly riskThreshold = 0.7;

  constructor() {
    this.initializeDefaultRules();
  }

  private initializeDefaultRules(): void {
    for (const template of DEFAULT_RULES) {
      const id = `rule_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      this.filterRules.set(id, {
        ...template,
        id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    this.logger.log(
      `Pre-transmission filter initialized with ${this.filterRules.size} rules`,
    );
  }

  async filterContent(
    content: string,
    context: FilterContext,
  ): Promise<FilterResult> {
    const startTime = Date.now();

    const cacheKey = this.generateCacheKey(content, context);
    const cached = this.detectionCache.get(cacheKey);
    if (cached) return cached;

    let filteredText = content;
    const detections: Detection[] = [];
    const rulesApplied: string[] = [];
    const blockingRules: string[] = [];
    let redactionCount = 0;
    let blocked = false;
    let blockReason = '';

    for (const rule of this.filterRules.values()) {
      if (!rule.enabled) continue;
      const ruleDetection = this.applyFilterRule(filteredText, rule);
      if (ruleDetection.matches.length > 0) {
        detections.push(ruleDetection);
        rulesApplied.push(rule.id);
        switch (rule.action) {
          case 'block':
            blocked = true;
            blockReason = `Blocked due to ${rule.name}: ${ruleDetection.matches.length} matches`;
            blockingRules.push(rule.id);
            break;
          case 'redact':
            filteredText = this.applyRedaction(
              filteredText,
              rule,
              ruleDetection.matches,
            );
            redactionCount += ruleDetection.matches.length;
            break;
          case 'alert':
            this.recordAlert(rule, ruleDetection, context);
            break;
          case 'log':
            this.logger.log(
              `PII filter: ${rule.name} - ${ruleDetection.matches.length} matches`,
            );
            break;
        }
      }
    }

    const riskScore = this.calculateRiskScore(detections);
    if (riskScore > this.riskThreshold && !blocked) {
      blocked = true;
      blockReason = `Risk score ${riskScore.toFixed(2)} exceeds threshold ${this.riskThreshold}`;
    }

    const processingTime = Date.now() - startTime;
    const result: FilterResult = {
      allowed: !blocked,
      modified: filteredText !== content,
      originalText: content,
      filteredText,
      detections,
      riskScore,
      blockedReason: blocked ? blockReason : undefined,
      timestamp: Date.now(),
      metadata: { processingTime, rulesApplied, redactionCount, blockingRules },
    };

    this.detectionCache.set(cacheKey, result);
    if (this.detectionCache.size > this.MAX_CACHE_SIZE) {
      const firstKey = this.detectionCache.keys().next().value;
      if (firstKey) this.detectionCache.delete(firstKey);
    }
    this.updateStatistics(result, processingTime);

    if (blocked || riskScore > 0.5) {
      this.logger.warn('Pre-transmission filtering applied', {
        allowed: result.allowed,
        riskScore: result.riskScore,
        detections: result.detections.length,
        redactionCount,
        blockReason,
      });
    }

    return result;
  }

  getStatistics(): FilterStatistics {
    return {
      ...this.filterStats,
      uptime: Date.now() - this.filterStats.uptime,
    };
  }

  async getRecentAlerts(limit: number = 50): Promise<
    Array<{
      id: string;
      timestamp: number;
      rule: string;
      severity: string;
      context?: FilterContext;
    }>
  > {
    return this.recentAlerts.slice(-limit).reverse();
  }

  private generateCacheKey(content: string, context: FilterContext): string {
    const crypto = require('crypto');
    return crypto
      .createHash('sha256')
      .update(`${content}:${context.userId}:${context.provider ?? ''}`)
      .digest('hex')
      .slice(0, 32);
  }

  private applyFilterRule(content: string, rule: FilterRule): Detection {
    const matches: Detection['matches'] = [];
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const matchText = match[0];
      const position = match.index;
      const contextStart = Math.max(0, position - 20);
      const contextEnd = Math.min(
        content.length,
        position + matchText.length + 20,
      );
      matches.push({
        text: matchText,
        position,
        length: matchText.length,
        context: content.substring(contextStart, contextEnd),
      });
      if (!pattern.global) break;
    }
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      category: rule.category,
      severity: rule.severity,
      pattern: rule.pattern.source,
      matches,
      action: rule.action,
      applied: matches.length > 0,
    };
  }

  private applyRedaction(
    content: string,
    rule: FilterRule,
    matches: Detection['matches'],
  ): string {
    const replacement =
      rule.replacement ?? `[${rule.category.toUpperCase()}_REDACTED]`;
    const sorted = [...matches].sort((a, b) => b.position - a.position);
    let result = content;
    for (const m of sorted) {
      result =
        result.substring(0, m.position) +
        replacement +
        result.substring(m.position + m.length);
    }
    return result;
  }

  private calculateRiskScore(detections: Detection[]): number {
    if (detections.length === 0) return 0;
    const weights: Record<string, number> = {
      low: 0.1,
      medium: 0.3,
      high: 0.6,
      critical: 1.0,
    };
    let total = 0;
    let max = 0;
    for (const d of detections) {
      const w = weights[d.severity] ?? 0.3;
      const score = w * Math.min(d.matches.length / 5, 1);
      total += score;
      max += w;
    }
    return max > 0 ? Math.min(total / max, 1) : 0;
  }

  private recordAlert(
    rule: FilterRule,
    _detection: Detection,
    context: FilterContext,
  ): void {
    this.recentAlerts.push({
      id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      timestamp: Date.now(),
      rule: rule.name,
      severity: rule.severity,
      context,
    });
    if (this.recentAlerts.length > this.MAX_RECENT_ALERTS)
      this.recentAlerts.shift();
  }

  private updateStatistics(result: FilterResult, processingTime: number): void {
    this.filterStats.totalRequests++;
    if (result.modified || result.detections.length > 0)
      this.filterStats.filteredRequests++;
    if (!result.allowed) this.filterStats.blockedRequests++;
    if (result.metadata.redactionCount > 0) this.filterStats.redactedRequests++;
    this.filterStats.piiDetections += result.detections
      .filter((d) => d.category === 'pii')
      .reduce((s, d) => s + d.matches.length, 0);
    const n = this.filterStats.totalRequests;
    this.filterStats.averageProcessingTime =
      (this.filterStats.averageProcessingTime * (n - 1) + processingTime) / n;
  }
}
