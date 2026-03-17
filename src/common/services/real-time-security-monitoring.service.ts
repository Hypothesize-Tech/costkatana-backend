/**
 * Real-Time Security Monitoring Service for NestJS
 * Provides real-time security monitoring dashboard with data lineage tracking
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  SecurityAlert as SecurityAlertSchema,
  SecurityAlertDocument,
} from '../../schemas/security/security-alert.schema';
import { ThreatLog } from '../../schemas/security/threat-log.schema';
import { AIProviderAudit } from '../../schemas/security/ai-provider-audit.schema';
import * as crypto from 'crypto';

export interface SecurityMetrics {
  timestamp: number;

  // Threat metrics
  threats: {
    active_threats: number;
    threat_level: 'low' | 'medium' | 'high' | 'critical';
    blocked_attempts: number;
    suspicious_activities: number;
    anomaly_score: number;
  };

  // Data protection metrics
  data_protection: {
    pii_detections: number;
    blocked_transmissions: number;
    redacted_content: number;
    classification_events: number;
    high_risk_data: number;
  };

  // Compliance metrics
  compliance: {
    active_violations: number;
    critical_violations: number;
    consent_requests: number;
    consent_granted: number;
    audit_events: number;
  };

  // System metrics
  system: {
    security_events_per_minute: number;
    average_response_time: number;
    error_rate: number;
    uptime_percentage: number;
    active_sessions: number;
  };

  // AI processing metrics
  ai_processing: {
    requests_processed: number;
    requests_blocked: number;
    ai_risk_score: number;
    provider_distribution: Record<string, number>;
    cost_at_risk: number;
  };
}

export interface SecurityAlert {
  alertId: string;
  timestamp: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  category:
    | 'threat'
    | 'compliance'
    | 'data_protection'
    | 'system'
    | 'ai_security';

  // Alert details
  alert: {
    title: string;
    description: string;
    source: string;
    confidence: number; // 0-1
    urgency: 'low' | 'medium' | 'high' | 'immediate';
  };

  // Affected resources
  affected: {
    users: string[];
    systems: string[];
    data: string[];
    services: string[];
  };

  // Threat intelligence
  threat: {
    type: string;
    vector: string;
    indicators: string[];
    attribution?: string;
    ttps?: string[]; // Tactics, Techniques, Procedures
  };

  // Response information
  response: {
    status:
      | 'new'
      | 'investigating'
      | 'contained'
      | 'resolved'
      | 'false_positive';
    assigned_to?: string;
    response_time?: number;
    resolution_notes?: string;
  };

  // Metadata
  metadata: {
    correlation_id?: string;
    event_chain?: string[];
    tags: string[];
    custom_fields: Record<string, any>;
  };
}

export interface DataFlowEvent {
  flowId: string;
  timestamp: number;
  correlationId: string;

  // Flow details
  flow: {
    source: {
      user_id?: string;
      session_id?: string;
      service: string;
      endpoint: string;
      ip_address?: string;
      user_agent?: string;
    };
    destination: {
      service: string;
      endpoint: string;
      data_types: string[];
      sensitivity_level: 'public' | 'internal' | 'sensitive' | 'restricted';
    };
    data: {
      size_bytes: number;
      classification: string;
      contains_pii: boolean;
      encryption_status: 'encrypted' | 'unencrypted' | 'redacted';
    };
  };

  // Security context
  security: {
    risk_score: number;
    compliance_flags: string[];
    required_consent: boolean;
    audit_required: boolean;
  };

  // Processing status
  status: {
    current: 'initiated' | 'processing' | 'completed' | 'blocked' | 'failed';
    checkpoints: Array<{
      name: string;
      timestamp: number;
      status: 'passed' | 'failed' | 'skipped';
      details?: string;
    }>;
  };

  // Metadata
  metadata: {
    business_context?: string;
    cost_impact?: number;
    tags: string[];
    custom_fields: Record<string, any>;
  };
}

export interface MonitoringDashboard {
  dashboardId: string;
  timestamp: number;
  period: {
    start: number;
    end: number;
    duration_minutes: number;
  };

  // Current metrics
  current_metrics: SecurityMetrics;

  // Historical trends
  trends: {
    threats_over_time: Array<{
      timestamp: number;
      count: number;
      level: string;
    }>;
    compliance_trends: Array<{
      timestamp: number;
      violations: number;
      resolved: number;
    }>;
    system_performance: Array<{
      timestamp: number;
      events_per_minute: number;
      error_rate: number;
    }>;
  };

  // Active alerts
  active_alerts: SecurityAlert[];

  // Data flows
  active_flows: DataFlowEvent[];

  // Threat landscape
  threat_landscape: {
    top_threats: Array<{
      type: string;
      count: number;
      severity: string;
      trend: 'increasing' | 'stable' | 'decreasing';
    }>;
    geographic_distribution: Record<string, number>;
    attack_vectors: Record<string, number>;
    threat_actors: Array<{
      name: string;
      confidence: number;
      last_seen: number;
    }>;
  };

  // Compliance status
  compliance_status: {
    overall_score: number;
    violations_by_category: Record<string, number>;
    critical_findings: string[];
    next_audit_date?: number;
    remediation_progress: number; // 0-100
  };

  // Risk assessment
  risk_assessment: {
    overall_risk_level: 'low' | 'medium' | 'high' | 'critical';
    risk_factors: Array<{ factor: string; weight: number; score: number }>;
    risk_trends: Array<{ timestamp: number; risk_score: number }>;
    mitigation_recommendations: Array<{
      priority: number;
      action: string;
      impact: number;
    }>;
  };

  // System health
  system_health: {
    components: Array<{
      name: string;
      status: 'healthy' | 'degraded' | 'unhealthy' | 'down';
      uptime_percentage: number;
      last_incident?: number;
      metrics: Record<string, number>;
    }>;
    overall_health_score: number;
    critical_components: string[];
  };
}

export interface MonitoringConfig {
  enableRealTimeMonitoring: boolean;
  alertThresholds: {
    maxActiveAlerts: number;
    threatLevelThreshold: 'low' | 'medium' | 'high' | 'critical';
    anomalyScoreThreshold: number;
    eventsPerMinuteThreshold: number;
  };
  dataRetention: {
    metricsHistoryHours: number;
    alertHistoryDays: number;
    flowHistoryHours: number;
  };
  compliance: {
    enableAutomatedAudits: boolean;
    auditFrequencyHours: number;
    criticalViolationThreshold: number;
  };
  notifications: {
    enableEmailAlerts: boolean;
    enableSlackAlerts: boolean;
    alertEscalationMinutes: number;
  };
}

@Injectable()
export class RealTimeSecurityMonitoringService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RealTimeSecurityMonitoringService.name);

  private activeAlerts: Map<string, SecurityAlert> = new Map();
  private dataFlows: Map<string, DataFlowEvent> = new Map();
  private threatIntelligence = new Map<string, any>();

  private currentMetrics: SecurityMetrics;
  private metricsHistory: SecurityMetrics[] = [];
  private config: MonitoringConfig;

  private readonly MAX_ALERTS = 1000;
  private readonly MAX_FLOWS = 10000;
  private readonly METRICS_RETENTION_HOURS = 24;

  private metricsInterval?: NodeJS.Timeout;
  private cleanupInterval?: NodeJS.Timeout;
  private alertProcessingInterval?: NodeJS.Timeout;

  private stats = {
    uptime: Date.now(),
    totalAlerts: 0,
    totalFlows: 0,
    blockedRequests: 0,
    averageResponseTime: 0,
    lastHealthCheck: Date.now(),
  };

  constructor(
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    @InjectModel(SecurityAlertSchema.name)
    private readonly securityAlertModel: Model<SecurityAlertDocument>,
    @InjectModel(ThreatLog.name)
    private readonly threatLogModel: Model<ThreatLog>,
    @InjectModel(AIProviderAudit.name)
    private readonly aiProviderAuditModel: Model<AIProviderAudit>,
  ) {
    this.initializeConfig();
    this.currentMetrics = this.initializeMetrics();
  }

  onModuleInit(): void {
    this.startRealTimeMonitoring();
    this.setupServiceEventListeners();
  }

  onModuleDestroy(): void {
    this.cleanup();
  }

  private initializeConfig(): void {
    this.config = {
      enableRealTimeMonitoring: this.configService.get<boolean>(
        'ENABLE_REAL_TIME_SECURITY_MONITORING',
        true,
      ),
      alertThresholds: {
        maxActiveAlerts: this.configService.get<number>(
          'MAX_ACTIVE_ALERTS',
          100,
        ),
        threatLevelThreshold: this.configService.get<
          'low' | 'medium' | 'high' | 'critical'
        >('THREAT_LEVEL_THRESHOLD', 'high'),
        anomalyScoreThreshold: this.configService.get<number>(
          'ANOMALY_SCORE_THRESHOLD',
          0.8,
        ),
        eventsPerMinuteThreshold: this.configService.get<number>(
          'EVENTS_PER_MINUTE_THRESHOLD',
          100,
        ),
      },
      dataRetention: {
        metricsHistoryHours: this.configService.get<number>(
          'METRICS_HISTORY_HOURS',
          24,
        ),
        alertHistoryDays: this.configService.get<number>(
          'ALERT_HISTORY_DAYS',
          30,
        ),
        flowHistoryHours: this.configService.get<number>(
          'FLOW_HISTORY_HOURS',
          72,
        ),
      },
      compliance: {
        enableAutomatedAudits: this.configService.get<boolean>(
          'ENABLE_AUTOMATED_AUDITS',
          true,
        ),
        auditFrequencyHours: this.configService.get<number>(
          'AUDIT_FREQUENCY_HOURS',
          24,
        ),
        criticalViolationThreshold: this.configService.get<number>(
          'CRITICAL_VIOLATION_THRESHOLD',
          5,
        ),
      },
      notifications: {
        enableEmailAlerts: this.configService.get<boolean>(
          'ENABLE_EMAIL_SECURITY_ALERTS',
          true,
        ),
        enableSlackAlerts: this.configService.get<boolean>(
          'ENABLE_SLACK_SECURITY_ALERTS',
          false,
        ),
        alertEscalationMinutes: this.configService.get<number>(
          'ALERT_ESCALATION_MINUTES',
          30,
        ),
      },
    };
  }

  /**
   * Get monitoring dashboard with comprehensive security overview
   */
  async getMonitoringDashboard(): Promise<MonitoringDashboard> {
    const dashboardId = this.generateDashboardId();
    const now = Date.now();
    const periodStart = now - 60 * 60 * 1000; // Last hour

    try {
      // Update current metrics
      await this.updateCurrentMetrics();

      const dashboard: MonitoringDashboard = {
        dashboardId,
        timestamp: now,
        period: {
          start: periodStart,
          end: now,
          duration_minutes: 60,
        },
        current_metrics: { ...this.currentMetrics },
        trends: {
          threats_over_time: this.getThreatsOverTime(),
          compliance_trends: this.getComplianceTrends(),
          system_performance: this.getSystemPerformanceTrends(),
        },
        active_alerts: Array.from(this.activeAlerts.values()),
        active_flows: Array.from(this.dataFlows.values()),
        threat_landscape: await this.analyzeThreatLandscape(),
        compliance_status: await this.getComplianceStatus(),
        risk_assessment: this.generateRiskAssessment(),
        system_health: this.getSystemHealth(),
      };

      this.logger.log('Security monitoring dashboard generated', {
        dashboardId,
        activeAlerts: dashboard.active_alerts.length,
        activeFlows: dashboard.active_flows.length,
        threatLevel: dashboard.current_metrics.threats.threat_level,
      });

      return dashboard;
    } catch (error) {
      this.logger.error('Failed to generate monitoring dashboard', {
        dashboardId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Track data flow for security monitoring
   */
  async trackDataFlow(
    source: DataFlowEvent['flow']['source'],
    destination: DataFlowEvent['flow']['destination'],
    data: DataFlowEvent['flow']['data'],
    metadata?: Partial<DataFlowEvent['metadata']>,
  ): Promise<string> {
    const flowId = this.generateFlowId();
    const correlationId = this.generateCorrelationId();

    const dataFlow: DataFlowEvent = {
      flowId,
      timestamp: Date.now(),
      correlationId,
      flow: { source, destination, data },
      security: {
        risk_score: await this.calculateFlowRiskScore(
          source,
          destination,
          data,
        ),
        compliance_flags: await this.checkComplianceFlags(data, destination),
        required_consent:
          data.contains_pii || destination.sensitivity_level === 'restricted',
        audit_required:
          destination.sensitivity_level === 'restricted' || data.contains_pii,
      },
      status: {
        current: 'initiated',
        checkpoints: [],
      },
      metadata: {
        business_context: metadata?.business_context,
        cost_impact: metadata?.cost_impact,
        tags: metadata?.tags || [],
        custom_fields: metadata?.custom_fields || {},
      },
    };

    this.dataFlows.set(flowId, dataFlow);
    this.stats.totalFlows++;

    // Emit event for other services to listen
    this.eventEmitter.emit('dataFlow.tracked', dataFlow);

    // Check for security concerns
    await this.analyzeFlowSecurity(source, destination, data, flowId);

    // Add checkpoint
    dataFlow.status.checkpoints.push({
      name: 'flow_initiated',
      timestamp: Date.now(),
      status: 'passed',
    });

    this.logger.log('Data flow tracked', {
      flowId,
      correlationId,
      source: source.service,
      destination: destination.service,
      riskScore: dataFlow.security.risk_score,
    });

    return flowId;
  }

  /**
   * Update data flow status
   */
  async updateDataFlowStatus(
    flowId: string,
    status: DataFlowEvent['status']['current'],
    checkpoint?: {
      name: string;
      status: 'passed' | 'failed' | 'skipped';
      details?: string;
    },
  ): Promise<void> {
    const dataFlow = this.dataFlows.get(flowId);
    if (!dataFlow) {
      this.logger.warn('Data flow not found for status update', { flowId });
      return;
    }

    const previousStatus = dataFlow.status.current;
    dataFlow.status.current = status;

    if (checkpoint) {
      dataFlow.status.checkpoints.push({
        ...checkpoint,
        timestamp: Date.now(),
      });
    }

    // Emit status change event
    this.eventEmitter.emit('dataFlow.statusChanged', {
      flowId,
      previousStatus,
      newStatus: status,
      checkpoint,
    });

    // Check for completion or failure
    if (status === 'completed') {
      this.eventEmitter.emit('dataFlow.completed', dataFlow);
    } else if (status === 'failed') {
      this.eventEmitter.emit('dataFlow.failed', dataFlow);
      await this.generateDataFlowAlert(dataFlow);
    } else if (status === 'blocked') {
      this.eventEmitter.emit('dataFlow.blocked', dataFlow);
      await this.generateDataFlowAlert(dataFlow);
    }

    this.logger.log('Data flow status updated', {
      flowId,
      status,
      checkpoint: checkpoint?.name,
    });
  }

  /**
   * Generate security alert
   */
  async generateAlert(
    category: SecurityAlert['category'],
    alertDetails: Omit<SecurityAlert['alert'], 'confidence' | 'urgency'> & {
      confidence?: number;
      urgency?: SecurityAlert['alert']['urgency'];
    },
    threatInfo?: Partial<SecurityAlert['threat']>,
    affectedResources?: Partial<SecurityAlert['affected']>,
  ): Promise<string> {
    const confidence = alertDetails.confidence ?? 0.8;
    const detailsWithDefaults = { ...alertDetails, confidence };
    const alertId = this.generateAlertId();

    const alert: SecurityAlert = {
      alertId,
      timestamp: Date.now(),
      severity: this.determineAlertSeverity(category, detailsWithDefaults),
      category,
      alert: {
        title: alertDetails.title,
        description: alertDetails.description,
        source: alertDetails.source,
        confidence,
        urgency:
          alertDetails.urgency ??
          this.determineAlertUrgency(category, detailsWithDefaults),
      },
      affected: {
        users: affectedResources?.users || [],
        systems: affectedResources?.systems || [],
        data: affectedResources?.data || [],
        services: affectedResources?.services || [],
      },
      threat: {
        type: threatInfo?.type || 'unknown',
        vector: threatInfo?.vector || 'unknown',
        indicators: threatInfo?.indicators || [],
        attribution: threatInfo?.attribution,
        ttps: threatInfo?.ttps,
      },
      response: {
        status: 'new',
      },
      metadata: {
        tags: [],
        custom_fields: {},
      },
    };

    this.activeAlerts.set(alertId, alert);
    this.stats.totalAlerts++;

    // Emit alert event
    this.eventEmitter.emit('alert.generated', alert);

    // Store alert for persistence
    await this.storeAlert(alert);

    // Trigger automated response if critical
    if (alert.severity === 'critical' || alert.alert.urgency === 'immediate') {
      await this.triggerAutomatedResponse(alert);
    }

    this.logger.log('Security alert generated', {
      alertId,
      category,
      severity: alert.severity,
      title: alert.alert.title,
    });

    return alertId;
  }

  /**
   * Update current security metrics
   */
  private async updateCurrentMetrics(): Promise<void> {
    try {
      const now = Date.now();

      this.currentMetrics = {
        timestamp: now,
        threats: {
          active_threats: this.activeAlerts.size,
          threat_level: this.calculateOverallThreatLevel(
            Array.from(this.activeAlerts.values()),
          ),
          blocked_attempts: this.stats.blockedRequests,
          suspicious_activities: await this.calculateSuspiciousActivities(),
          anomaly_score: this.calculateAverageAnomalyScore(),
        },
        data_protection: {
          pii_detections: await this.calculatePIIDetections(),
          blocked_transmissions: this.stats.blockedRequests,
          redacted_content: await this.calculateRedactedContent(),
          classification_events: await this.calculateClassificationEvents(),
          high_risk_data: await this.calculateHighRiskData(),
        },
        compliance: {
          active_violations: await this.calculateActiveViolations(),
          critical_violations: await this.calculateCriticalViolations(),
          consent_requests: await this.calculateConsentRequests(),
          consent_granted: await this.calculateConsentGranted(),
          audit_events: await this.calculateAuditEvents(),
        },
        system: {
          security_events_per_minute: this.calculateEventsPerMinute(),
          average_response_time: this.stats.averageResponseTime,
          error_rate: this.calculateErrorRate(),
          uptime_percentage: this.calculateUptimePercentage(),
          active_sessions: await this.getActiveSessionCount(),
        },
        ai_processing: {
          requests_processed: await this.calculateProcessedRequests(),
          requests_blocked: this.stats.blockedRequests,
          ai_risk_score: this.calculateAIRiskScore(
            await this.getAIProcessingStats(),
          ),
          provider_distribution: await this.getProviderDistribution(),
          cost_at_risk: this.calculateCostAtRisk(
            await this.getAIProcessingStats(),
          ),
        },
      };

      // Add to history
      this.metricsHistory.push({ ...this.currentMetrics });
      if (this.metricsHistory.length > this.METRICS_RETENTION_HOURS * 60) {
        this.metricsHistory.shift(); // Keep last N hours of metrics
      }
    } catch (error) {
      this.logger.error('Failed to update current metrics', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Analyze flow security
   */
  private async analyzeFlowSecurity(
    source: DataFlowEvent['flow']['source'],
    destination: DataFlowEvent['flow']['destination'],
    data: DataFlowEvent['flow']['data'],
    flowId: string,
  ): Promise<void> {
    try {
      // Check for high-risk patterns
      const riskFactors: string[] = [];

      if (data.contains_pii && data.encryption_status === 'unencrypted') {
        riskFactors.push('unencrypted_pii');
      }

      if (destination.sensitivity_level === 'restricted' && !source.user_id) {
        riskFactors.push('unauthenticated_restricted_data');
      }

      if (
        destination.data_types.includes('financial') &&
        !data.encryption_status
      ) {
        riskFactors.push('unencrypted_financial_data');
      }

      // Generate alert if high risk
      if (riskFactors.length > 0) {
        await this.generateAlert(
          'data_protection',
          {
            title: 'High-risk data flow detected',
            description: `Data flow ${flowId} contains high-risk patterns: ${riskFactors.join(', ')}`,
            source: 'flow_analysis',
            confidence: 0.9,
          },
          {
            type: 'data_exfiltration',
            vector: 'internal_flow',
            indicators: riskFactors,
          },
          {
            services: [source.service, destination.service],
            data: [data.classification],
          },
        );
      }
    } catch (error) {
      this.logger.error('Flow security analysis failed', {
        flowId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Analyze threat landscape
   */
  private analyzeThreatLandscape(): Promise<
    MonitoringDashboard['threat_landscape']
  > {
    const recentAlerts = Array.from(this.activeAlerts.values()).filter(
      (alert) => alert.timestamp > Date.now() - 24 * 60 * 60 * 1000,
    ); // Last 24 hours

    return Promise.resolve({
      top_threats: this.aggregateThreats(recentAlerts),
      geographic_distribution: this.aggregateGeographicThreats(recentAlerts),
      attack_vectors: this.aggregateAttackVectors(recentAlerts),
      threat_actors: [], // Would integrate with threat intelligence feeds
    });
  }

  /**
   * Get compliance status
   */
  private getComplianceStatus(): Promise<
    MonitoringDashboard['compliance_status']
  > {
    // This would integrate with compliance services
    return Promise.resolve({
      overall_score: 85,
      violations_by_category: {
        gdpr: 2,
        hipaa: 0,
        pci: 1,
        sox: 0,
      },
      critical_findings: ['Data retention policy violation'],
      next_audit_date: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
      remediation_progress: 65,
    });
  }

  /**
   * Setup service event listeners
   */
  private setupServiceEventListeners(): void {
    interface AuditEventPayload {
      type: string;
      details?: string;
      policy?: string;
    }
    interface AIBlockedPayload {
      reason?: string;
      vector?: string;
    }

    this.eventEmitter.on('audit.event', (event: AuditEventPayload) => {
      if (event.type === 'security_violation') {
        void this.generateAlert(
          'compliance',
          {
            title: 'Security policy violation detected',
            description: event.details ?? 'Security violation',
            source: 'audit_service',
          },
          {
            type: 'policy_violation',
            vector: 'internal',
            indicators: event.policy ? [event.policy] : [],
          },
        );
      }
    });

    this.eventEmitter.on('ai.request.blocked', (event: AIBlockedPayload) => {
      this.stats.blockedRequests++;
      void this.generateAlert(
        'ai_security',
        {
          title: 'AI request blocked by security policy',
          description: `Request blocked: ${event.reason ?? 'unknown'}`,
          source: 'ai_processing',
        },
        {
          type: 'ai_abuse',
          vector: event.vector ?? 'unknown',
          indicators: event.reason ? [event.reason] : [],
        },
      );
    });

    this.logger.log('Service event listeners configured');
  }

  /**
   * Start real-time monitoring
   */
  private startRealTimeMonitoring(): void {
    if (!this.config.enableRealTimeMonitoring) return;

    // Update metrics every minute
    this.metricsInterval = setInterval(() => {
      void this.updateCurrentMetrics();
      void this.checkAlertThresholds();
    }, 60000);

    // Process active alerts every 5 minutes
    this.alertProcessingInterval = setInterval(() => {
      void this.processActiveAlerts();
    }, 300000);

    // Cleanup old data every hour
    this.cleanupInterval = setInterval(() => {
      this.cleanupAlerts();
      this.cleanupDataFlows();
    }, 3600000);

    this.logger.log('Real-time security monitoring started');
  }

  /**
   * Initialize metrics structure
   */
  private initializeMetrics(): SecurityMetrics {
    return {
      timestamp: Date.now(),
      threats: {
        active_threats: 0,
        threat_level: 'low',
        blocked_attempts: 0,
        suspicious_activities: 0,
        anomaly_score: 0,
      },
      data_protection: {
        pii_detections: 0,
        blocked_transmissions: 0,
        redacted_content: 0,
        classification_events: 0,
        high_risk_data: 0,
      },
      compliance: {
        active_violations: 0,
        critical_violations: 0,
        consent_requests: 0,
        consent_granted: 0,
        audit_events: 0,
      },
      system: {
        security_events_per_minute: 0,
        average_response_time: 0,
        error_rate: 0,
        uptime_percentage: 100,
        active_sessions: 0,
      },
      ai_processing: {
        requests_processed: 0,
        requests_blocked: 0,
        ai_risk_score: 0,
        provider_distribution: {},
        cost_at_risk: 0,
      },
    };
  }

  // Helper methods for metrics calculation
  private calculateOverallThreatLevel(
    alerts: SecurityAlert[],
  ): 'low' | 'medium' | 'high' | 'critical' {
    if (alerts.some((a) => a.severity === 'critical')) return 'critical';
    if (alerts.some((a) => a.severity === 'high')) return 'high';
    if (alerts.some((a) => a.severity === 'medium')) return 'medium';
    return 'low';
  }

  private calculateAverageAnomalyScore(): number {
    if (this.metricsHistory.length === 0) return 0;
    const recentMetrics = this.metricsHistory.slice(-10); // Last 10 minutes
    return (
      recentMetrics.reduce((sum, m) => sum + m.threats.anomaly_score, 0) /
      recentMetrics.length
    );
  }

  private calculateEventsPerMinute(): number {
    if (this.metricsHistory.length < 2) return 0;
    const recent = this.metricsHistory.slice(-2);
    const events1 = recent[0].system.security_events_per_minute;
    const events2 = recent[1].system.security_events_per_minute;
    return (events1 + events2) / 2;
  }

  private calculateErrorRate(): number {
    if (this.metricsHistory.length === 0) return 0;
    const recent = this.metricsHistory.slice(-10);
    return (
      recent.reduce((sum, m) => sum + m.system.error_rate, 0) / recent.length
    );
  }

  private calculateUptimePercentage(): number {
    const uptime = Date.now() - this.stats.uptime;
    const totalTime = uptime + (this.stats.lastHealthCheck - this.stats.uptime);
    return totalTime > 0 ? (uptime / totalTime) * 100 : 100;
  }

  private getActiveSessionCount(): Promise<number> {
    // Derive from tracked flows: unique user/session identifiers in active data flows
    const sessionIds = new Set<string>();
    for (const flow of this.dataFlows.values()) {
      if (
        flow.status.current === 'initiated' ||
        flow.status.current === 'processing'
      ) {
        const sid =
          flow.flow.source.session_id ||
          flow.flow.source.user_id ||
          flow.flowId;
        sessionIds.add(sid);
      }
    }
    return Promise.resolve(sessionIds.size);
  }

  private calculateAIRiskScore(stats: {
    totalRequests: number;
    blockedRequests: number;
    costAtRisk: number;
  }): number {
    if (stats.totalRequests === 0) return 0;
    const blockRate = stats.blockedRequests / stats.totalRequests;
    return Math.min(blockRate * 100, 100);
  }

  private getProviderDistribution(): Promise<Record<string, number>> {
    // Derive from active flows and alerts: count by service/destination
    const distribution: Record<string, number> = {};
    for (const flow of this.dataFlows.values()) {
      const key = flow.flow.destination.service || 'unknown';
      distribution[key] = (distribution[key] || 0) + 1;
    }
    for (const alert of this.activeAlerts.values()) {
      if (alert.category === 'ai_security') {
        const key = 'ai_processing';
        distribution[key] = (distribution[key] || 0) + 1;
      }
    }
    return Promise.resolve(distribution);
  }

  private calculateCostAtRisk(stats: {
    totalRequests: number;
    blockedRequests: number;
    costAtRisk: number;
  }): number {
    return stats.costAtRisk || 0;
  }

  private async calculateSuspiciousActivities(): Promise<number> {
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const count = await this.threatLogModel.countDocuments({
      timestamp: { $gte: windowStart },
    });
    return Math.min(count, 100);
  }

  private async calculatePIIDetections(): Promise<number> {
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const count = await this.aiProviderAuditModel.countDocuments({
      createdAt: { $gte: windowStart },
      'security.piiDetected.0': { $exists: true },
    });
    return count;
  }

  private async calculateRedactedContent(): Promise<number> {
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const count = await this.aiProviderAuditModel.countDocuments({
      createdAt: { $gte: windowStart },
      'security.redactionApplied': true,
    });
    return count;
  }

  private calculateClassificationEvents(): Promise<number> {
    return Promise.resolve(this.dataFlows.size + this.activeAlerts.size);
  }

  private calculateHighRiskData(): Promise<number> {
    return Promise.resolve(
      Array.from(this.dataFlows.values()).filter(
        (f) =>
          f.flow.destination.sensitivity_level === 'restricted' ||
          f.security.risk_score > 70,
      ).length,
    );
  }

  private calculateActiveViolations(): Promise<number> {
    return Promise.resolve(
      Array.from(this.activeAlerts.values()).filter(
        (a) => a.category === 'compliance',
      ).length,
    );
  }

  private calculateCriticalViolations(): Promise<number> {
    return Promise.resolve(
      Array.from(this.activeAlerts.values()).filter(
        (a) => a.category === 'compliance' && a.severity === 'critical',
      ).length,
    );
  }

  private calculateConsentRequests(): Promise<number> {
    return Promise.resolve(
      Array.from(this.dataFlows.values()).filter(
        (f) => f.security.required_consent,
      ).length,
    );
  }

  private calculateConsentGranted(): Promise<number> {
    const required = Array.from(this.dataFlows.values()).filter(
      (f) => f.security.required_consent,
    ).length;
    return Promise.resolve(Math.max(0, required - this.activeAlerts.size));
  }

  private calculateAuditEvents(): Promise<number> {
    return Promise.resolve(this.dataFlows.size + this.activeAlerts.size * 2);
  }

  private calculateProcessedRequests(): Promise<number> {
    return Promise.resolve(
      this.stats.totalFlows +
        this.stats.totalAlerts +
        this.stats.blockedRequests,
    );
  }

  private getAIProcessingStats(): Promise<{
    totalRequests: number;
    blockedRequests: number;
    costAtRisk: number;
  }> {
    const total = this.stats.totalFlows + this.stats.totalAlerts;
    return Promise.resolve({
      totalRequests: total,
      blockedRequests: this.stats.blockedRequests,
      costAtRisk: total * 0.001,
    });
  }

  private calculateFlowRiskScore(
    source: DataFlowEvent['flow']['source'],
    destination: DataFlowEvent['flow']['destination'],
    data: DataFlowEvent['flow']['data'],
  ): Promise<number> {
    let score = 0;

    if (data.contains_pii) score += 30;
    if (destination.sensitivity_level === 'restricted') score += 40;
    if (data.encryption_status === 'unencrypted') score += 20;
    if (!source.user_id) score += 15;

    return Promise.resolve(Math.min(score, 100));
  }

  private checkComplianceFlags(
    data: DataFlowEvent['flow']['data'],
    destination: DataFlowEvent['flow']['destination'],
  ): Promise<string[]> {
    const flags: string[] = [];

    if (data.contains_pii) flags.push('pii_transfer');
    if (destination.sensitivity_level === 'restricted')
      flags.push('restricted_data');
    if (data.encryption_status === 'unencrypted')
      flags.push('unencrypted_transfer');

    return Promise.resolve(flags);
  }

  private determineAlertSeverity(
    category: SecurityAlert['category'],
    alertDetails: Pick<SecurityAlert['alert'], 'confidence'> &
      Partial<Pick<SecurityAlert['alert'], 'urgency'>>,
  ): SecurityAlert['severity'] {
    if (alertDetails.confidence > 0.9 && category === 'threat')
      return 'critical';
    if (alertDetails.confidence > 0.7) return 'high';
    if (alertDetails.confidence > 0.5) return 'medium';
    return 'low';
  }

  private determineAlertUrgency(
    category: SecurityAlert['category'],
    alertDetails: Pick<SecurityAlert['alert'], 'confidence'> &
      Partial<Pick<SecurityAlert['alert'], 'urgency'>>,
  ): SecurityAlert['alert']['urgency'] {
    if (alertDetails.confidence > 0.9 && category === 'threat')
      return 'immediate';
    if (alertDetails.confidence > 0.8) return 'high';
    if (alertDetails.confidence > 0.6) return 'medium';
    return 'low';
  }

  // Trend analysis methods
  private getThreatsOverTime(): Array<{
    timestamp: number;
    count: number;
    level: string;
  }> {
    return this.metricsHistory.slice(-60).map((m) => ({
      timestamp: m.timestamp,
      count: m.threats.active_threats,
      level: m.threats.threat_level,
    }));
  }

  private getComplianceTrends(): Array<{
    timestamp: number;
    violations: number;
    resolved: number;
  }> {
    // Derive from metrics history: use compliance metrics when available
    if (this.metricsHistory.length === 0) {
      return [];
    }
    return this.metricsHistory.slice(-60).map((m) => ({
      timestamp: m.timestamp,
      violations: m.compliance.active_violations,
      resolved: Math.max(
        0,
        (m.compliance.audit_events || 0) - m.compliance.active_violations,
      ),
    }));
  }

  private getSystemPerformanceTrends(): Array<{
    timestamp: number;
    events_per_minute: number;
    error_rate: number;
  }> {
    return this.metricsHistory.slice(-60).map((m) => ({
      timestamp: m.timestamp,
      events_per_minute: m.system.security_events_per_minute,
      error_rate: m.system.error_rate,
    }));
  }

  private generateRiskAssessment(): MonitoringDashboard['risk_assessment'] {
    const currentRisk = this.calculateAverageAnomalyScore() * 10;
    return {
      overall_risk_level:
        currentRisk > 7
          ? 'critical'
          : currentRisk > 5
            ? 'high'
            : currentRisk > 3
              ? 'medium'
              : 'low',
      risk_factors: [
        {
          factor: 'threat_activity',
          weight: 0.4,
          score: this.currentMetrics.threats.active_threats * 2,
        },
        {
          factor: 'compliance_violations',
          weight: 0.3,
          score: this.currentMetrics.compliance.active_violations * 5,
        },
        {
          factor: 'data_protection',
          weight: 0.3,
          score: this.currentMetrics.data_protection.pii_detections * 3,
        },
      ],
      risk_trends: this.metricsHistory.slice(-24).map((m) => ({
        timestamp: m.timestamp,
        risk_score: m.threats.anomaly_score * 10,
      })),
      mitigation_recommendations: [
        { priority: 1, action: 'Review active security alerts', impact: 8 },
        { priority: 2, action: 'Address compliance violations', impact: 6 },
        { priority: 3, action: 'Enhance data protection measures', impact: 7 },
      ],
    };
  }

  private getSystemHealth(): MonitoringDashboard['system_health'] {
    return {
      components: [
        {
          name: 'security_monitoring',
          status: 'healthy',
          uptime_percentage: 99.9,
          metrics: {
            active_alerts: this.activeAlerts.size,
            events_per_minute: this.calculateEventsPerMinute(),
          },
        },
        {
          name: 'data_flow_tracking',
          status: 'healthy',
          uptime_percentage: 99.5,
          metrics: {
            active_flows: this.dataFlows.size,
            risk_score_avg: 15,
          },
        },
      ],
      overall_health_score: 95,
      critical_components: [],
    };
  }

  private aggregateThreats(alerts: SecurityAlert[]): Array<{
    type: string;
    count: number;
    severity: string;
    trend: 'increasing' | 'stable' | 'decreasing';
  }> {
    const threatCounts: Record<string, number> = {};
    for (const alert of alerts) {
      threatCounts[alert.threat.type] =
        (threatCounts[alert.threat.type] || 0) + 1;
    }

    return Object.entries(threatCounts).map(([type, count]) => ({
      type,
      count,
      severity: 'medium', // Simplified
      trend: 'stable', // Would calculate from historical data
    }));
  }

  private aggregateGeographicThreats(
    alerts: SecurityAlert[],
  ): Record<string, number> {
    // Would aggregate by geographic location of threats
    return {
      'us-east': Math.floor(alerts.length * 0.4),
      'eu-west': Math.floor(alerts.length * 0.3),
      'asia-pacific': Math.floor(alerts.length * 0.3),
    };
  }

  private aggregateAttackVectors(
    alerts: SecurityAlert[],
  ): Record<string, number> {
    const vectors: Record<string, number> = {};
    for (const alert of alerts) {
      vectors[alert.threat.vector] = (vectors[alert.threat.vector] || 0) + 1;
    }
    return vectors;
  }

  private async checkAlertThresholds(): Promise<void> {
    const metrics = this.currentMetrics;

    if (this.activeAlerts.size > this.config.alertThresholds.maxActiveAlerts) {
      await this.generateAlert('system', {
        title: 'Alert threshold exceeded',
        description: `Active alerts (${this.activeAlerts.size}) exceed threshold (${this.config.alertThresholds.maxActiveAlerts})`,
        source: 'monitoring_system',
        confidence: 1.0,
      });
    }

    if (
      metrics.threats.anomaly_score >
      this.config.alertThresholds.anomalyScoreThreshold
    ) {
      await this.generateAlert('threat', {
        title: 'High anomaly score detected',
        description: `Anomaly score (${metrics.threats.anomaly_score.toFixed(2)}) exceeds threshold`,
        source: 'anomaly_detection',
        confidence: 0.9,
      });
    }
  }

  private processActiveAlerts(): Promise<void> {
    // Process and potentially auto-resolve alerts
    for (const [alertId, alert] of this.activeAlerts.entries()) {
      // Auto-resolve old low-severity alerts
      if (alert.severity === 'low' && Date.now() - alert.timestamp > 3600000) {
        // 1 hour
        alert.response.status = 'resolved';
        alert.response.resolution_notes =
          'Auto-resolved: Low severity alert aged out';
        this.activeAlerts.delete(alertId);
      }
    }
    return Promise.resolve();
  }

  private async generateDataFlowAlert(dataFlow: DataFlowEvent): Promise<void> {
    await this.generateAlert(
      'data_protection',
      {
        title: 'Data flow security incident',
        description: `Data flow ${dataFlow.flowId} encountered security issue: ${dataFlow.status.current}`,
        source: 'flow_monitoring',
        confidence: 0.8,
      },
      {
        type: 'data_security',
        vector: 'internal_transfer',
        indicators: [`flow_${dataFlow.flowId}`],
      },
      {
        services: [
          dataFlow.flow.source.service,
          dataFlow.flow.destination.service,
        ],
        data: [dataFlow.flow.data.classification],
      },
    );
  }

  private triggerAutomatedResponse(alert: SecurityAlert): Promise<void> {
    try {
      // Implement automated response logic
      this.logger.log('Automated response triggered', {
        alertId: alert.alertId,
        severity: alert.severity,
      });

      // For critical alerts, could trigger:
      // - Immediate notifications
      // - Traffic throttling
      // - Service isolation
      // - Incident response procedures
    } catch (error) {
      this.logger.error('Automated response failed', {
        alertId: alert.alertId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return Promise.resolve();
  }

  private async storeAlert(alert: SecurityAlert): Promise<void> {
    try {
      // Persist the alert to database
      const alertData: Record<string, unknown> = {
        alertId: alert.alertId,
        timestamp: alert.timestamp,
        severity: alert.severity,
        category: alert.category,
        alert: alert.alert,
        affected: alert.affected,
        threat: alert.threat,
        response: alert.response,
        metadata: alert.metadata,
        audit_trail: [
          {
            action: 'alert_created',
            timestamp: Date.now(),
            details: 'Alert created by real-time security monitoring',
          },
        ],
      };
      if ('evidence' in alert && alert.evidence != null) {
        alertData.evidence = alert.evidence;
      }
      await this.securityAlertModel.create(alertData);

      this.logger.debug('Alert stored in database', { alertId: alert.alertId });
    } catch (error) {
      this.logger.error('Failed to store alert in database', {
        alertId: alert.alertId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private cleanupAlerts(): void {
    if (this.activeAlerts.size <= this.MAX_ALERTS) return;

    // Remove oldest resolved alerts first
    const resolvedAlerts = Array.from(this.activeAlerts.entries())
      .filter(([, alert]) => alert.response.status === 'resolved')
      .sort(([, a], [, b]) => a.timestamp - b.timestamp);

    for (const [alertId] of resolvedAlerts.slice(
      0,
      this.activeAlerts.size - this.MAX_ALERTS,
    )) {
      this.activeAlerts.delete(alertId);
    }

    // If still over limit, remove oldest alerts regardless of status
    if (this.activeAlerts.size > this.MAX_ALERTS) {
      const allAlerts = Array.from(this.activeAlerts.entries()).sort(
        ([, a], [, b]) => a.timestamp - b.timestamp,
      );

      for (const [alertId] of allAlerts.slice(
        0,
        this.activeAlerts.size - this.MAX_ALERTS,
      )) {
        this.activeAlerts.delete(alertId);
      }
    }
  }

  private cleanupDataFlows(): void {
    if (this.dataFlows.size <= this.MAX_FLOWS) return;

    // Remove completed flows first
    const completedFlows = Array.from(this.dataFlows.entries())
      .filter(([, flow]) => flow.status.current === 'completed')
      .sort(([, a], [, b]) => a.timestamp - b.timestamp);

    for (const [flowId] of completedFlows.slice(
      0,
      this.dataFlows.size - this.MAX_FLOWS,
    )) {
      this.dataFlows.delete(flowId);
    }

    // If still over limit, remove oldest flows
    if (this.dataFlows.size > this.MAX_FLOWS) {
      const allFlows = Array.from(this.dataFlows.entries()).sort(
        ([, a], [, b]) => a.timestamp - b.timestamp,
      );

      for (const [flowId] of allFlows.slice(
        0,
        this.dataFlows.size - this.MAX_FLOWS,
      )) {
        this.dataFlows.delete(flowId);
      }
    }
  }

  private generateDashboardId(): string {
    return `dash_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  private generateAlertId(): string {
    return `alert_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  }

  private generateFlowId(): string {
    return `flow_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  }

  private generateCorrelationId(): string {
    return `corr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * Get statistics for monitoring
   */
  getStatistics(): typeof this.stats & {
    activeAlerts: number;
    activeFlows: number;
    config: MonitoringConfig;
  } {
    return {
      ...this.stats,
      activeAlerts: this.activeAlerts.size,
      activeFlows: this.dataFlows.size,
      config: this.config,
    };
  }

  /**
   * Update monitoring configuration
   */
  updateConfig(newConfig: Partial<MonitoringConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger.log('Monitoring configuration updated');
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    if (this.alertProcessingInterval) {
      clearInterval(this.alertProcessingInterval);
    }

    this.activeAlerts.clear();
    this.dataFlows.clear();
    this.metricsHistory = [];

    this.logger.log('Real-time security monitoring cleaned up');
  }
}
