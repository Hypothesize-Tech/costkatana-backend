import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import {
  AIProviderAudit,
  AIProviderAuditDocument,
} from '../../../schemas/security/ai-provider-audit.schema';
import {
  UserDataConsent,
  UserDataConsentDocument,
} from '../../../schemas/security/user-data-consent.schema';

export interface AIProviderRequest {
  requestId: string;
  userId: string;
  provider: 'anthropic' | 'openai' | 'bedrock' | 'custom';
  model: string;
  timestamp: number;
  endpoint: string;
  method: string;

  // Data being sent
  requestData?: {
    prompt?: string;
    messages?: any[];
    systemPrompt?: string;
    context?: string;
    attachments?: string[];
    parameters: Record<string, any>;
  };

  // Metadata
  metadata: {
    userTier: string;
    sessionId: string;
    ipAddress: string;
    userAgent: string;
    referer?: string;
    contentLength: number;
    estimatedTokens: number;
    estimatedCost: number;
  };

  // Security analysis
  security: {
    piiDetected: string[];
    sensitivePatterns: string[];
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    complianceFlags: string[];
    dataClassification: string[];
    redactionApplied: boolean;
    redactionDetails?: {
      originalLength: number;
      redactedLength: number;
      patternsRedacted: string[];
      redactionMap: Record<string, string>;
      redactionTimestamp: number;
    };
  };

  // Transmission details
  transmission: {
    status: 'pending' | 'sent' | 'failed' | 'blocked';
    sentAt?: number;
    responseReceived?: number;
    responseSize?: number;
    errorDetails?: string;
    blockedReason?: string;
  };

  // Compliance tracking
  compliance: {
    gdprApplicable: boolean;
    hipaaApplicable: boolean;
    soc2Applicable: boolean;
    consentObtained: boolean;
    legalBasis?: string;
    dataRetentionPolicy: string;
    geographicRestrictions: string[];
  };
}

export interface AIProviderResponse {
  requestId: string;
  responseId: string;
  timestamp: number;

  // Response data
  responseData?: {
    content?: string;
    usage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
    metadata?: Record<string, any>;
  };

  // Security analysis of response
  security: {
    piiDetected: string[];
    sensitivePatterns: string[];
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    complianceFlags: string[];
    dataClassification: string[];
    redactionApplied: boolean;
    redactionDetails?: {
      originalLength: number;
      redactedLength: number;
      patternsRedacted: string[];
      redactionMap: Record<string, string>;
      redactionTimestamp: number;
    };
  };

  // Transmission details
  transmission: {
    status: 'received' | 'failed' | 'blocked';
    receivedAt?: number;
    responseSize?: number;
    errorDetails?: string;
    blockedReason?: string;
  };

  // Compliance tracking
  compliance: {
    gdprApplicable: boolean;
    hipaaApplicable: boolean;
    soc2Applicable: boolean;
    consentObtained: boolean;
    legalBasis?: string;
    dataRetentionPolicy: string;
    geographicRestrictions: string[];
  };
}

export interface RedactionDetails {
  originalLength: number;
  redactedLength: number;
  patternsRedacted: string[];
  redactionMap: Record<string, string>; // For potential restoration
  redactionTimestamp: number;
}

export interface AuditQuery {
  userId?: string;
  provider?: string;
  timeRange?: { start: number; end: number };
  riskLevel?: ('low' | 'medium' | 'high' | 'critical')[];
  limit?: number;
  offset?: number;
}

export interface ComplianceReport {
  reportId: string;
  generatedAt: number;
  timeRange: { start: number; end: number };
  summary: {
    totalRequests: number;
    piiRequestsCount: number;
    highRiskRequests: number;
    blockedRequests: number;
    complianceViolations: number;
  };
  breakdown: {
    byProvider: Record<string, number>;
    byRiskLevel: Record<string, number>;
    byPiiType: Record<string, number>;
    byComplianceFlag: Record<string, number>;
  };
  violations: Array<{
    requestId: string;
    timestamp: number;
    violations: string[];
    severity: 'low' | 'medium' | 'high' | 'critical';
  }>;
  recommendations: string[];
}

@Injectable()
export class AIProviderAuditService
  extends EventEmitter
  implements OnModuleInit
{
  private readonly logger = new Logger(AIProviderAuditService.name);
  private recentRequests = new Map<string, AIProviderRequest>();

  constructor(
    @InjectModel(AIProviderAudit.name)
    private auditModel: Model<AIProviderAuditDocument>,
    @InjectModel(UserDataConsent.name)
    private userDataConsentModel: Model<UserDataConsentDocument>,
  ) {
    super();
  }

  async onModuleInit() {
    this.logger.log('AIProviderAuditService initialized');
  }

  /**
   * Record an AI provider request
   */
  async recordRequest(request: AIProviderRequest): Promise<void> {
    try {
      // Store in memory for quick access
      this.recentRequests.set(request.requestId, request);

      // Persist to database
      const auditDocument = {
        requestId: request.requestId,
        userId: request.userId,
        provider: request.provider,
        model: request.model,
        timestamp: request.timestamp,
        endpoint: request.endpoint,
        method: request.method,
        requestData: request.requestData,
        metadata: request.metadata,
        security: request.security,
        transmission: request.transmission,
        compliance: request.compliance,
      };

      await this.auditModel.create(auditDocument);

      // Emit event for real-time processing
      this.emit('ai_request_recorded', request);

      // Clean up old entries from memory (keep last 1000)
      if (this.recentRequests.size > 1000) {
        const oldestKey = this.recentRequests.keys().next().value;
        this.recentRequests.delete(oldestKey);
      }
    } catch (error) {
      this.logger.error('Failed to record AI provider request', {
        error: error instanceof Error ? error.message : String(error),
        requestId: request.requestId,
        userId: request.userId,
      });
      throw error;
    }
  }

  /**
   * Record an AI provider response
   */
  async recordResponse(response: AIProviderResponse): Promise<void> {
    try {
      // Update the request record with response data
      const request = this.recentRequests.get(response.requestId);
      if (request) {
        // Update transmission status
        request.transmission.status =
          response.transmission.status === 'received'
            ? 'sent'
            : response.transmission.status;
        request.transmission.responseReceived =
          (response as { receivedAt?: number }).receivedAt ?? Date.now();

        // Update in database
        await this.auditModel.updateOne(
          { requestId: response.requestId },
          {
            $set: {
              'transmission.status': request.transmission.status,
              'transmission.responseReceived':
                request.transmission.responseReceived,
            },
          },
        );

        // Emit event
        this.emit('ai_response_recorded', { request, response });
      }
    } catch (error) {
      this.logger.error('Failed to record AI provider response', {
        error: error instanceof Error ? error.message : String(error),
        requestId: response.requestId,
      });
    }
  }

  /**
   * Query audit records
   */
  async queryAuditRecords(query: AuditQuery): Promise<{
    records: AIProviderRequest[];
    total: number;
    hasMore: boolean;
  }> {
    try {
      const filter: any = {};

      // User filter
      if (query.userId) {
        filter.userId = query.userId;
      }

      // Provider filter
      if (query.provider) {
        filter.provider = query.provider;
      }

      // Time range filter
      if (query.timeRange) {
        filter.timestamp = {
          $gte: query.timeRange.start,
          $lte: query.timeRange.end,
        };
      }

      // Risk level filter
      if (query.riskLevel?.length) {
        filter['security.riskLevel'] = { $in: query.riskLevel };
      }

      // Get total count
      const total = await this.auditModel.countDocuments(filter);

      // Get paginated results
      const records = await this.auditModel
        .find(filter)
        .sort({ timestamp: -1 })
        .skip(query.offset || 0)
        .limit(query.limit || 100)
        .populate('userId', 'email name')
        .lean();

      const hasMore = (query.offset || 0) + (query.limit || 100) < total;

      return {
        records: records.map(this.convertToAIProviderRequest),
        total,
        hasMore,
      };
    } catch (error) {
      this.logger.error('Failed to query audit records', {
        error: error instanceof Error ? error.message : String(error),
        query,
      });
      return { records: [], total: 0, hasMore: false };
    }
  }

  /**
   * Generate compliance report
   */
  async generateComplianceReport(timeRange: {
    start: number;
    end: number;
  }): Promise<ComplianceReport> {
    const reportId = this.generateReportId();
    const generatedAt = Date.now();

    try {
      const { records } = await this.queryAuditRecords({
        timeRange,
        limit: 10000,
      });

      const summary = {
        totalRequests: records.length,
        piiRequestsCount: records.filter(
          (r) => r.security.piiDetected.length > 0,
        ).length,
        highRiskRequests: records.filter(
          (r) =>
            r.security.riskLevel === 'high' ||
            r.security.riskLevel === 'critical',
        ).length,
        blockedRequests: records.filter(
          (r) => r.transmission.status === 'blocked',
        ).length,
        complianceViolations: records.filter(
          (r) => r.security.complianceFlags.length > 0,
        ).length,
      };

      const breakdown = {
        byProvider: this.groupBy(records, (r) => r.provider),
        byRiskLevel: this.groupBy(records, (r) => r.security.riskLevel),
        byPiiType: this.groupByArray(records, (r) => r.security.piiDetected),
        byComplianceFlag: this.groupByArray(
          records,
          (r) => r.security.complianceFlags,
        ),
      };

      const violations = records
        .filter((r) => r.security.complianceFlags.length > 0)
        .map((r) => ({
          requestId: r.requestId,
          timestamp: r.timestamp,
          violations: r.security.complianceFlags,
          severity: r.security.riskLevel,
        }));

      const recommendations = this.generateComplianceRecommendations(
        summary,
        breakdown,
      );

      const report: ComplianceReport = {
        reportId,
        generatedAt,
        timeRange,
        summary,
        breakdown,
        violations,
        recommendations,
      };

      this.logger.log('AI provider compliance report generated', {
        reportId,
        totalRequests: summary.totalRequests,
        violationsCount: summary.complianceViolations,
      });

      return report;
    } catch (error) {
      this.logger.error('Failed to generate compliance report', {
        error: error instanceof Error ? error.message : String(error),
        timeRange,
      });
      throw error;
    }
  }

  /**
   * Analyze data for PII detection
   */
  analyzeDataForPII(data: string): {
    piiDetected: string[];
    sensitivePatterns: string[];
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
  } {
    const piiDetected: string[] = [];
    const sensitivePatterns: string[] = [];

    // Email pattern
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    if (emailRegex.test(data)) {
      piiDetected.push('email');
      sensitivePatterns.push('email_address');
    }

    // Phone number pattern (basic)
    const phoneRegex = /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g;
    if (phoneRegex.test(data)) {
      piiDetected.push('phone');
      sensitivePatterns.push('phone_number');
    }

    // SSN pattern
    const ssnRegex = /\b\d{3}[-]?\d{2}[-]?\d{4}\b/g;
    if (ssnRegex.test(data)) {
      piiDetected.push('ssn');
      sensitivePatterns.push('social_security_number');
    }

    // Credit card pattern (basic)
    const ccRegex = /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g;
    if (ccRegex.test(data)) {
      piiDetected.push('credit_card');
      sensitivePatterns.push('credit_card_number');
    }

    // Determine risk level
    let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (piiDetected.includes('ssn') || piiDetected.includes('credit_card')) {
      riskLevel = 'critical';
    } else if (piiDetected.length > 1) {
      riskLevel = 'high';
    } else if (piiDetected.length === 1) {
      riskLevel = 'medium';
    }

    return { piiDetected, sensitivePatterns, riskLevel };
  }

  /**
   * Check actual user consent records for GDPR compliance.
   * Queries UserDataConsent collection instead of heuristics.
   */
  async getUserConsentForAIProcessing(userId: string): Promise<boolean> {
    if (!userId || userId === 'anonymous') {
      return false;
    }
    try {
      const consent = await this.userDataConsentModel
        .findOne({
          userId,
          purpose: 'ai_processing',
        })
        .sort({ consentedAt: -1 })
        .lean();
      return consent?.consented === true;
    } catch (error) {
      this.logger.warn('Failed to fetch user consent', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Check compliance requirements using actual user consent records.
   */
  async checkCompliance(
    data: string,
    context: { userId: string; provider: string; model: string },
  ): Promise<{
    gdprApplicable: boolean;
    hipaaApplicable: boolean;
    soc2Applicable: boolean;
    consentObtained: boolean;
    complianceFlags: string[];
    dataRetentionPolicy: string;
  }> {
    const complianceFlags: string[] = [];

    // Analyze data for compliance implications
    const { piiDetected } = this.analyzeDataForPII(data);

    const gdprApplicable =
      piiDetected.length > 0 || context.provider === 'openai'; // EU-based providers
    const hipaaApplicable =
      piiDetected.includes('medical') || context.provider === 'custom'; // Health data
    const soc2Applicable = true; // All AI processing requires SOC2 compliance

    // Check actual user consent records from database (GDPR: explicit opt-in required when PII present)
    let consentObtained: boolean;
    if (!gdprApplicable || piiDetected.length === 0) {
      // No GDPR implications or no PII — consent not required for processing
      consentObtained = true;
    } else {
      consentObtained = await this.getUserConsentForAIProcessing(
        context.userId,
      );
    }

    // Generate compliance flags
    if (gdprApplicable && !consentObtained) {
      complianceFlags.push('gdpr_consent_required');
    }
    if (hipaaApplicable) {
      complianceFlags.push('hipaa_compliance_required');
    }
    if (piiDetected.length > 0) {
      complianceFlags.push('pii_processing');
    }

    return {
      gdprApplicable,
      hipaaApplicable,
      soc2Applicable,
      consentObtained,
      complianceFlags,
      dataRetentionPolicy:
        piiDetected.length > 0 ? 'encrypted_7_years' : 'standard_1_year',
    };
  }

  private groupBy<T>(
    items: T[],
    keyFn: (item: T) => string,
  ): Record<string, number> {
    return items.reduce(
      (acc, item) => {
        const key = keyFn(item);
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
  }

  private groupByArray<T>(
    items: T[],
    keyFn: (item: T) => string[],
  ): Record<string, number> {
    const result: Record<string, number> = {};
    items.forEach((item) => {
      const keys = keyFn(item);
      keys.forEach((key) => {
        result[key] = (result[key] || 0) + 1;
      });
    });
    return result;
  }

  private generateComplianceRecommendations(
    summary: ComplianceReport['summary'],
    breakdown: ComplianceReport['breakdown'],
  ): string[] {
    const recommendations: string[] = [];

    if (summary.piiRequestsCount > summary.totalRequests * 0.1) {
      recommendations.push(
        'High volume of PII processing detected - review data minimization practices',
      );
    }

    if (summary.highRiskRequests > summary.totalRequests * 0.05) {
      recommendations.push(
        'Significant high-risk AI requests - enhance risk assessment and monitoring',
      );
    }

    if (summary.blockedRequests > summary.totalRequests * 0.01) {
      recommendations.push(
        'Requests being blocked - review blocking criteria and user communication',
      );
    }

    if (summary.complianceViolations > 0) {
      recommendations.push(
        'Compliance violations detected - implement corrective actions and prevent recurrence',
      );
    }

    if (Object.keys(breakdown.byProvider).length > 3) {
      recommendations.push(
        'Multiple AI providers in use - ensure consistent compliance across all providers',
      );
    }

    recommendations.push(
      'Implement regular compliance training for users handling sensitive data',
    );
    recommendations.push(
      'Establish clear data retention and deletion policies',
    );
    recommendations.push(
      'Conduct regular compliance audits and risk assessments',
    );

    return recommendations;
  }

  private generateReportId(): string {
    return `compliance-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  }

  private convertToAIProviderRequest(doc: any): AIProviderRequest {
    return {
      requestId: doc.requestId,
      userId: doc.userId,
      provider: doc.provider,
      model: doc.model,
      timestamp: doc.timestamp,
      endpoint: doc.endpoint,
      method: doc.method,
      requestData: doc.requestData,
      metadata: doc.metadata,
      security: doc.security,
      transmission: doc.transmission,
      compliance: doc.compliance,
    };
  }
}
