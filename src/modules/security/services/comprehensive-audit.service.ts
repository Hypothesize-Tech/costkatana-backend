import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import {
  ComprehensiveAudit,
  ComprehensiveAuditDocument,
  AuditEventType,
  AuditSeverity,
} from '../../../schemas/security/comprehensive-audit.schema';

export interface DataLineageInfo {
  sourceId: string;
  sourceName: string;
  sourceType: string;
  transformations: Array<{
    step: number;
    operation: string;
    timestamp: number;
    component: string;
    inputHash: string;
    outputHash: string;
  }>;
  destinations: Array<{
    destinationId: string;
    destinationType: string;
    timestamp: number;
    purpose: string;
  }>;
  retentionPolicy: {
    period: number;
    autoDelete: boolean;
    deleteAfter: number;
  };
}

export interface AuditEvent {
  eventId: string;
  timestamp: number;
  eventType: AuditEventType;
  severity: AuditSeverity;
  event: {
    action: string;
    description: string;
    outcome: 'success' | 'failure' | 'partial' | 'blocked';
    category: string;
    subcategory?: string;
  };
  actor: {
    type: 'user' | 'system' | 'api' | 'service' | 'admin';
    id: string;
    name?: string;
    role?: string;
    permissions?: string[];
    sessionId?: string;
    ipAddress?: string;
    userAgent?: string;
    location?: {
      country: string;
      region: string;
      city: string;
    };
  };
  target: {
    type: 'user' | 'data' | 'file' | 'system' | 'service' | 'configuration';
    id: string;
    name?: string;
    classification?: string;
    sensitivity?: string;
    owner?: string;
    metadata?: Record<string, any>;
  };
  context?: {
    requestId?: string;
    correlationId?: string;
    parentEventId?: string;
    businessContext?: string;
    technicalContext?: string;
    complianceFramework?: string[];
    dataLineage?: DataLineageInfo;
  };
  security: {
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    securityImplications: string[];
    complianceImplications: string[];
    privacyImplications: string[];
    anomalyScore: number;
    threatIndicators: string[];
  };
  technical: {
    sourceSystem: string;
    sourceComponent: string;
    protocol?: string;
    method?: string;
    endpoint?: string;
    responseCode?: number;
    duration?: number;
    dataSize?: number;
    errorDetails?: string;
  };
  evidence?: {
    beforeState?: string;
    afterState?: string;
    artifacts?: Array<{
      type: string;
      location: string;
      hash?: string;
    }>;
    logs?: string[];
  };
  metadata?: Record<string, any>;
}

export interface AuditQuery {
  timeRange?: { start: number; end: number };
  eventTypes?: AuditEventType[];
  severities?: AuditSeverity[];
  actorId?: string;
  actorType?: 'user' | 'system' | 'api' | 'service' | 'admin';
  targetId?: string;
  targetType?:
    | 'user'
    | 'data'
    | 'file'
    | 'system'
    | 'service'
    | 'configuration';
  riskLevel?: ('low' | 'medium' | 'high' | 'critical')[];
  limit?: number;
  offset?: number;
}

export interface AuditAggregations {
  byType: Record<AuditEventType, number>;
  bySeverity: Record<AuditSeverity, number>;
  byRiskLevel: Record<string, number>;
  byActor: Record<string, number>;
  byTarget: Record<string, number>;
  byComponent: Record<string, number>;
}

export interface AuditReport {
  reportId: string;
  generatedAt: number;
  generatedBy: string;
  reportType: string;
  parameters: any;
  summary: {
    totalEvents: number;
    eventsByType: Record<AuditEventType, number>;
    eventsBySeverity: Record<AuditSeverity, number>;
    uniqueActors: number;
    uniqueTargets: number;
    securityEvents: number;
    complianceEvents: number;
    anomalousEvents: number;
    failedEvents: number;
  };
  findings: Array<{
    type: string;
    severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
    title: string;
    description: string;
    evidence: string[];
    recommendations: string[];
  }>;
  recommendations: string[];
}

@Injectable()
export class ComprehensiveAuditService
  extends EventEmitter
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ComprehensiveAuditService.name);
  private eventBuffer: AuditEvent[] = [];
  private dataLineageMap = new Map<string, DataLineageInfo>();
  private flushInterval?: NodeJS.Timeout;
  private anomalyDetectionInterval?: NodeJS.Timeout;
  private anomalyBaselines = new Map<
    string,
    { mean: number; std: number; lastUpdated: number }
  >();

  private readonly config = {
    batchSize: 100,
    flushInterval: 30000, // 30 seconds
    maxBufferSize: 1000,
    anomalyDetectionThreshold: 0.6,
    maxAnomalyHistory: 10000,
  };

  constructor(
    @InjectModel(ComprehensiveAudit.name)
    private auditModel: Model<ComprehensiveAuditDocument>,
  ) {
    super();
  }

  async onModuleInit() {
    this.startEventProcessing();
    this.startAnomalyDetection();
    this.logger.log('ComprehensiveAuditService initialized');
  }

  async onModuleDestroy() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    if (this.anomalyDetectionInterval) {
      clearInterval(this.anomalyDetectionInterval);
    }
    await this.flushEventBuffer();
    this.logger.log('ComprehensiveAuditService destroyed');
  }

  /**
   * Record an audit event
   * @returns The generated event ID
   */
  async recordEvent(event: Omit<AuditEvent, 'eventId'>): Promise<string> {
    try {
      const auditEvent: AuditEvent = {
        ...event,
        eventId: this.generateEventId(),
      };

      // Add to buffer for batch processing
      this.eventBuffer.push(auditEvent);

      // Track data lineage if applicable
      if (event.context?.dataLineage) {
        await this.trackDataLineage(
          event.target.id,
          event.event.action,
          event.actor.id,
          event.context,
        );
      }

      // Emit event for real-time processing
      this.emit('audit_event', auditEvent);

      // Flush if buffer is full
      if (this.eventBuffer.length >= this.config.maxBufferSize) {
        await this.flushEventBuffer();
      }
      return auditEvent.eventId;
    } catch (error) {
      this.logger.error('Failed to record audit event', {
        error: error instanceof Error ? error.message : String(error),
        eventType: event.eventType,
        actorId: event.actor.id,
      });
      throw error;
    }
  }

  /**
   * Record a security event from the enterprise security guard.
   * Maps guard payload to full AuditEvent and returns the generated event ID.
   */
  async recordSecurityEvent(payload: {
    eventId?: string;
    timestamp: number;
    eventType: AuditEventType;
    severity: AuditSeverity;
    event: Record<string, any>;
    metadata?: Record<string, any>;
  }): Promise<string> {
    const event: Omit<AuditEvent, 'eventId'> = {
      timestamp: payload.timestamp,
      eventType: payload.eventType,
      severity: payload.severity,
      event: {
        action: payload.event.action ?? 'security_event',
        description: payload.event.description ?? '',
        outcome: payload.event.blocked ? 'blocked' : 'success',
        category: 'security',
        ...payload.event,
      },
      actor: {
        type: 'system',
        id: 'enterprise-security-guard',
        name: 'Enterprise Security Guard',
      },
      target: {
        type: 'system',
        id: payload.metadata?.requestId ?? 'unknown',
        name: payload.metadata?.path,
      },
      security: {
        riskLevel:
          payload.severity === 'high' || payload.severity === 'critical'
            ? 'high'
            : 'low',
        securityImplications: [],
        complianceImplications: [],
        privacyImplications: [],
        anomalyScore: 0,
        threatIndicators: [],
      },
      technical: {
        sourceSystem: 'cost-katana',
        sourceComponent: 'EnterpriseSecurityGuard',
        method: payload.metadata?.method,
      },
      context: payload.metadata?.requestId
        ? { requestId: payload.metadata.requestId }
        : undefined,
      metadata: payload.metadata,
    };
    return this.recordEvent(event);
  }

  /**
   * Query audit events
   */
  async queryEvents(query: AuditQuery): Promise<{
    events: AuditEvent[];
    aggregations: AuditAggregations;
    total: number;
  }> {
    try {
      const filter: any = {};

      // Time range filter
      if (query.timeRange) {
        filter.timestamp = {
          $gte: query.timeRange.start,
          $lte: query.timeRange.end,
        };
      }

      // Event type filter
      if (query.eventTypes?.length) {
        filter.eventType = { $in: query.eventTypes };
      }

      // Severity filter
      if (query.severities?.length) {
        filter.severity = { $in: query.severities };
      }

      // Actor filters
      if (query.actorId) {
        filter['actor.id'] = query.actorId;
      }
      if (query.actorType) {
        filter['actor.type'] = query.actorType;
      }

      // Target filters
      if (query.targetId) {
        filter['target.id'] = query.targetId;
      }
      if (query.targetType) {
        filter['target.type'] = query.targetType;
      }

      // Risk level filter
      if (query.riskLevel?.length) {
        filter['security.riskLevel'] = { $in: query.riskLevel };
      }

      // Get total count
      const total = await this.auditModel.countDocuments(filter);

      // Get paginated results
      const events = await this.auditModel
        .find(filter)
        .sort({ timestamp: -1 })
        .skip(query.offset || 0)
        .limit(query.limit || 100)
        .lean();

      // Calculate aggregations
      const aggregations = await this.calculateAggregations(filter);

      return {
        events: events.map(this.convertToAuditEvent),
        aggregations,
        total,
      };
    } catch (error) {
      this.logger.error('Failed to query audit events', {
        error: error instanceof Error ? error.message : String(error),
        query,
      });
      return {
        events: [],
        aggregations: this.getEmptyAggregations(),
        total: 0,
      };
    }
  }

  /**
   * Generate audit report
   */
  async generateAuditReport(
    reportType: string,
    parameters: any,
    generatedBy: string,
  ): Promise<AuditReport> {
    const reportId = this.generateReportId();

    try {
      // Query relevant events
      const query: AuditQuery = {
        timeRange: parameters.timeRange,
        limit: 50000, // Large limit for comprehensive report
      };

      const { events, aggregations } = await this.queryEvents(query);

      // Calculate summary statistics
      const summary = {
        totalEvents: events.length,
        eventsByType: aggregations.byType,
        eventsBySeverity: aggregations.bySeverity,
        uniqueActors: new Set(events.map((e) => e.actor.id)).size,
        uniqueTargets: new Set(events.map((e) => e.target.id)).size,
        securityEvents: events.filter((e) => e.eventType === 'security_event')
          .length,
        complianceEvents: events.filter(
          (e) => e.eventType === 'compliance_check',
        ).length,
        anomalousEvents: events.filter((e) => e.security.anomalyScore > 0.6)
          .length,
        failedEvents: events.filter((e) => e.event.outcome === 'failure')
          .length,
      };

      // Analyze findings based on report type
      const findings = await this.analyzeAuditFindings(
        reportType,
        events,
        parameters,
      );

      // Generate recommendations
      const recommendations = this.generateAuditRecommendations(
        reportType,
        findings,
        summary,
      );

      const report: AuditReport = {
        reportId,
        generatedAt: Date.now(),
        generatedBy,
        reportType,
        parameters,
        summary,
        findings,
        recommendations,
      };

      // Store report (we could create a separate collection for reports)
      await this.storeAuditReport(report);

      // Emit report event
      this.emit('audit_report_generated', {
        reportId,
        reportType,
        eventCount: summary.totalEvents,
        anomalousEvents: summary.anomalousEvents,
        securityEvents: summary.securityEvents,
      });

      this.logger.log('Comprehensive audit report generated', {
        reportId,
        reportType,
        eventCount: summary.totalEvents,
        timeRange: parameters.timeRange,
      });

      return report;
    } catch (error) {
      this.logger.error('Failed to generate audit report', {
        error: error instanceof Error ? error.message : String(error),
        reportType,
      });
      throw error;
    }
  }

  /**
   * Store audit report in the persistent audit_reports collection.
   * If the collection/model is not initialized, log a warning.
   * This enables future querying and traceability of comprehensive audit reports.
   */
  private async storeAuditReport(report: AuditReport): Promise<void> {
    try {
      // Check if an AuditReport model/collection exists on the service
      if (
        (this as any).auditReportModel &&
        typeof (this as any).auditReportModel.create === 'function'
      ) {
        // Save the report to the database
        await (this as any).auditReportModel.create(report);
        this.logger.log('Audit report persisted to audit_reports collection', {
          reportId: report.reportId,
        });
      } else {
        // Either not wired up or collection not set up yet
        this.logger.warn(
          'Audit report model not initialized; report NOT persisted to dedicated collection',
          { reportId: report.reportId },
        );
      }
    } catch (error) {
      this.logger.error('Error persisting audit report to collection', {
        error: error instanceof Error ? error.message : String(error),
        reportId: report.reportId,
      });
      // Optionally, consider throwing or just logging depending on use-case
    }
  }

  /**
   * Get data lineage for specific data item
   */
  getDataLineage(dataId: string): DataLineageInfo | null {
    return this.dataLineageMap.get(dataId) || null;
  }

  private async calculateAggregations(filter: any): Promise<AuditAggregations> {
    try {
      const aggregations = await this.auditModel.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            byType: {
              $push: '$eventType',
            },
            bySeverity: {
              $push: '$severity',
            },
            byRiskLevel: {
              $push: '$security.riskLevel',
            },
            byActor: {
              $push: '$actor.id',
            },
            byTarget: {
              $push: '$target.id',
            },
            byComponent: {
              $push: '$technical.sourceComponent',
            },
          },
        },
      ]);

      if (aggregations.length === 0) {
        return this.getEmptyAggregations();
      }

      const result = aggregations[0];
      return {
        byType: this.countOccurrences(result.byType),
        bySeverity: this.countOccurrences(result.bySeverity),
        byRiskLevel: this.countOccurrences(result.byRiskLevel),
        byActor: this.countOccurrences(result.byActor),
        byTarget: this.countOccurrences(result.byTarget),
        byComponent: this.countOccurrences(result.byComponent),
      };
    } catch (error) {
      this.logger.error('Failed to calculate aggregations', { error });
      return this.getEmptyAggregations();
    }
  }

  private getEmptyAggregations(): AuditAggregations {
    return {
      byType: {} as Record<AuditEventType, number>,
      bySeverity: {} as Record<AuditSeverity, number>,
      byRiskLevel: {},
      byActor: {},
      byTarget: {},
      byComponent: {},
    };
  }

  private countOccurrences(items: string[]): Record<string, number> {
    return items.reduce(
      (acc, item) => {
        acc[item] = (acc[item] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
  }

  private async analyzeAuditFindings(
    reportType: string,
    events: AuditEvent[],
    parameters: any,
  ): Promise<
    Array<{
      type: string;
      severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
      title: string;
      description: string;
      evidence: string[];
      recommendations: string[];
    }>
  > {
    const findings: Array<{
      type: string;
      severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
      title: string;
      description: string;
      evidence: string[];
      recommendations: string[];
    }> = [];

    // Security findings - use parameters for time-based analysis
    const securityEvents = events.filter(
      (e) => e.eventType === 'security_event',
    );
    if (securityEvents.length > 0) {
      const timeRange = parameters?.timeRange;
      const daysInRange = timeRange
        ? Math.ceil((timeRange.end - timeRange.start) / (24 * 60 * 60 * 1000))
        : 30;
      const eventsPerDay = securityEvents.length / daysInRange;

      findings.push({
        type: 'security',
        severity: securityEvents.some(
          (e) => e.severity === 'high' || e.severity === 'critical',
        )
          ? 'high'
          : 'medium',
        title: `${securityEvents.length} Security Events Detected (${eventsPerDay.toFixed(1)}/day)`,
        description: `Found ${securityEvents.length} security-related events in the audit period (${daysInRange} days).`,
        evidence: securityEvents
          .slice(0, 5)
          .map(
            (e) =>
              `${e.event.action} by ${e.actor.id} at ${new Date(e.timestamp).toISOString()}`,
          ),
        recommendations: [
          'Review security event patterns and frequency',
          'Implement additional monitoring for high-risk areas',
          'Update security policies based on findings',
          eventsPerDay > 10
            ? 'High security event frequency - investigate potential threats'
            : 'Monitor security event trends',
        ],
      });
    }

    // Compliance findings
    const complianceEvents = events.filter(
      (e) => e.eventType === 'compliance_check',
    );
    if (complianceEvents.length > 0) {
      const violations = complianceEvents.filter(
        (e) => e.event.outcome === 'failure',
      );
      if (violations.length > 0) {
        findings.push({
          type: 'compliance',
          severity: violations.length > 10 ? 'high' : 'medium',
          title: `${violations.length} Compliance Violations Detected`,
          description: `Found ${violations.length} compliance violations that require attention.`,
          evidence: violations
            .slice(0, 5)
            .map(
              (e) =>
                `${e.event.description} - ${e.security.complianceImplications.join(', ')}`,
            ),
          recommendations: [
            'Address compliance violations immediately',
            'Review compliance policies and procedures',
            'Implement additional compliance monitoring',
          ],
        });
      }
    }

    // Anomaly findings
    const anomalousEvents = events.filter((e) => e.security.anomalyScore > 0.6);
    if (anomalousEvents.length > 0) {
      findings.push({
        type: 'anomaly',
        severity: anomalousEvents.length > 50 ? 'high' : 'medium',
        title: `${anomalousEvents.length} Anomalous Events Detected`,
        description: `Found ${anomalousEvents.length} events with high anomaly scores indicating potential security concerns.`,
        evidence: anomalousEvents
          .slice(0, 5)
          .map(
            (e) =>
              `${e.event.action} (score: ${e.security.anomalyScore.toFixed(2)})`,
          ),
        recommendations: [
          'Investigate anomalous event patterns',
          'Review anomaly detection thresholds',
          'Implement additional security monitoring',
        ],
      });
    }

    return findings;
  }

  private generateAuditRecommendations(
    reportType: string,
    findings: any[],
    summary: any,
  ): string[] {
    const recommendations: string[] = [];

    // Use reportType to provide specific recommendations
    switch (reportType) {
      case 'security_audit':
        recommendations.push(
          'Conduct regular security audits and penetration testing',
        );
        recommendations.push('Implement automated vulnerability scanning');
        break;
      case 'compliance_audit':
        recommendations.push(
          'Review compliance frameworks and ensure proper documentation',
        );
        recommendations.push('Implement automated compliance monitoring');
        break;
      case 'access_audit':
        recommendations.push(
          'Review user access patterns and implement least privilege',
        );
        recommendations.push('Regular access rights reviews and cleanup');
        break;
      default:
        recommendations.push('Conduct comprehensive security assessment');
    }

    // Use findings to generate targeted recommendations
    const criticalFindings = findings.filter((f) => f.severity === 'critical');
    const highFindings = findings.filter((f) => f.severity === 'high');

    if (criticalFindings.length > 0) {
      recommendations.push(
        `Address ${criticalFindings.length} critical security findings immediately`,
      );
    }

    if (highFindings.length > 0) {
      recommendations.push(
        `Prioritize resolution of ${highFindings.length} high-priority security issues`,
      );
    }

    if (summary.failedEvents > summary.totalEvents * 0.1) {
      recommendations.push(
        'High failure rate detected - investigate system stability issues',
      );
    }

    if (summary.anomalousEvents > 10) {
      recommendations.push(
        'Multiple anomalous events detected - review security monitoring and alerting',
      );
    }

    if (summary.securityEvents > 100) {
      recommendations.push(
        'High volume of security events - consider implementing automated threat response',
      );
    }

    if (summary.complianceEvents === 0) {
      recommendations.push(
        'No compliance checks recorded - ensure compliance monitoring is active',
      );
    }

    recommendations.push('Implement regular security training for staff');
    recommendations.push('Review and update access control policies');
    recommendations.push('Enhance monitoring and alerting capabilities');

    return recommendations;
  }

  private async trackDataLineage(
    dataId: string,
    action: string,
    actorId: string,
    context?: any,
  ): Promise<DataLineageInfo> {
    let lineage = this.dataLineageMap.get(dataId);

    if (!lineage) {
      // Create new lineage record
      lineage = {
        sourceId: dataId,
        sourceName: context?.dataName || 'Unknown',
        sourceType: context?.dataType || 'Unknown',
        transformations: [],
        destinations: [],
        retentionPolicy: {
          period: 365, // Default 1 year
          autoDelete: true,
          deleteAfter: Date.now() + 365 * 24 * 60 * 60 * 1000,
        },
      };
      this.dataLineageMap.set(dataId, lineage);
    }

    // Add transformation step
    const transformation = {
      step: lineage.transformations.length + 1,
      operation: action,
      timestamp: Date.now(),
      component: context?.component || 'Unknown',
      inputHash: this.generateDataHash(dataId + action + Date.now()),
      outputHash: this.generateDataHash(
        dataId + action + Date.now() + 'output',
      ),
    };
    lineage.transformations.push(transformation);

    // Add destination if this is a transmission
    if (
      action.includes('transmit') ||
      action.includes('send') ||
      action.includes('export')
    ) {
      const destination = {
        destinationId: context?.destinationId || 'unknown',
        destinationType: context?.destinationType || 'external_service',
        timestamp: Date.now(),
        purpose: context?.purpose || 'processing',
      };
      lineage.destinations.push(destination);
    }

    return lineage;
  }

  private async flushEventBuffer(): Promise<void> {
    if (this.eventBuffer.length === 0) return;

    const eventsToFlush = [...this.eventBuffer];
    this.eventBuffer = [];

    try {
      // Process events in batches
      for (let i = 0; i < eventsToFlush.length; i += this.config.batchSize) {
        const batch = eventsToFlush.slice(i, i + this.config.batchSize);
        await this.processBatch(batch);
      }
    } catch (error) {
      this.logger.error('Event buffer flush failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async processBatch(events: AuditEvent[]): Promise<void> {
    try {
      const auditDocuments = events.map((event) => ({
        eventId: event.eventId,
        timestamp: event.timestamp,
        eventType: event.eventType,
        severity: event.severity,
        event: event.event,
        actor: event.actor,
        target: event.target,
        context: event.context,
        security: event.security,
        technical: event.technical,
        evidence: event.evidence,
        createdAt: new Date(event.timestamp),
      }));

      await this.auditModel.insertMany(auditDocuments);
    } catch (error) {
      this.logger.error('Failed to process audit event batch', {
        error: error instanceof Error ? error.message : String(error),
        batchSize: events.length,
      });
      throw error;
    }
  }

  private async updateAnomalyBaselines(): Promise<void> {
    try {
      // Get recent events for baseline calculation
      const recentEvents = await this.auditModel
        .find({
          timestamp: { $gte: Date.now() - 3600000 }, // Last hour
        })
        .select('eventType security.anomalyScore')
        .limit(this.config.maxAnomalyHistory)
        .lean();

      // Update baselines by event type
      const eventsByType = new Map<string, number[]>();
      recentEvents.forEach((event) => {
        const scores = eventsByType.get(event.eventType) || [];
        scores.push(event.security?.anomalyScore || 0);
        eventsByType.set(event.eventType, scores);
      });

      // Calculate new baselines
      for (const [eventType, scores] of eventsByType) {
        if (scores.length >= 10) {
          // Need minimum samples
          const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
          const variance =
            scores.reduce((a, b) => a + Math.pow(b - mean, 2), 0) /
            scores.length;
          const std = Math.sqrt(variance);

          this.anomalyBaselines.set(eventType, {
            mean,
            std,
            lastUpdated: Date.now(),
          });
        }
      }
    } catch (error) {
      this.logger.error('Failed to update anomaly baselines', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private startEventProcessing(): void {
    this.flushInterval = setInterval(async () => {
      try {
        await this.flushEventBuffer();
      } catch (error) {
        this.logger.error('Event buffer flush failed', {
          component: 'ComprehensiveAuditService',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, this.config.flushInterval);
  }

  private startAnomalyDetection(): void {
    this.anomalyDetectionInterval = setInterval(async () => {
      try {
        await this.updateAnomalyBaselines();
      } catch (error) {
        this.logger.error('Anomaly detection update failed', {
          component: 'ComprehensiveAuditService',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, 300000); // Every 5 minutes
  }

  private generateEventId(): string {
    return `audit-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  }

  private generateReportId(): string {
    return `report-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  }

  private generateDataHash(data: string): string {
    return crypto
      .createHash('sha256')
      .update(data)
      .digest('hex')
      .substring(0, 16);
  }

  private convertToAuditEvent(doc: any): AuditEvent {
    return {
      eventId: doc.eventId,
      timestamp: doc.timestamp,
      eventType: doc.eventType,
      severity: doc.severity,
      event: doc.event,
      actor: doc.actor,
      target: doc.target,
      context: doc.context,
      security: doc.security,
      technical: doc.technical,
      evidence: doc.evidence,
    };
  }
}
