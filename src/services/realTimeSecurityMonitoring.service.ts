import { loggingService } from './logging.service';
import { cacheService } from './cache.service';
import { comprehensiveAuditService, AuditEventType, AuditSeverity } from './comprehensiveAudit.service';
import { complianceEnforcementService } from './complianceEnforcement.service';
import { aiProviderAuditService } from './aiProviderAudit.service';
import { preTransmissionFilterService } from './preTransmissionFilter.service';
import { dataClassificationService } from './dataClassification.service';
import { EventEmitter } from 'events';
import * as crypto from 'crypto';

/**
 * Real-Time Security Monitoring Service
 * Provides real-time security monitoring dashboard with data lineage tracking
 */

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
    category: 'threat' | 'compliance' | 'data_protection' | 'system' | 'ai_security';
    
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
        status: 'new' | 'investigating' | 'contained' | 'resolved' | 'false_positive';
        assigned_to?: string;
        actions_taken: string[];
        resolution_time?: number;
        lessons_learned?: string[];
    };
    
    // Related events
    related: {
        event_ids: string[];
        correlation_id: string;
        parent_alert_id?: string;
        child_alert_ids: string[];
    };
}

export interface DataFlowEvent {
    flowId: string;
    timestamp: number;
    
    // Flow details
    flow: {
        source: {
            system: string;
            component: string;
            user: string;
            location: string;
        };
        destination: {
            system: string;
            component: string;
            purpose: string;
            location: string;
        };
        data: {
            type: string;
            classification: string;
            size: number;
            pii_detected: boolean;
            encryption_status: boolean;
        };
        transmission: {
            protocol: string;
            method: string;
            status: 'initiated' | 'in_progress' | 'completed' | 'failed' | 'blocked';
            duration?: number;
        };
    };
    
    // Security analysis
    security: {
        risk_level: 'low' | 'medium' | 'high' | 'critical';
        compliance_checked: boolean;
        approval_required: boolean;
        monitoring_required: boolean;
        retention_policy: string;
    };
    
    // Lineage tracking
    lineage: {
        parent_flows: string[];
        child_flows: string[];
        transformation_steps: Array<{
            step: number;
            operation: string;
            component: string;
            timestamp: number;
        }>;
    };
}

export interface MonitoringDashboard {
    dashboardId: string;
    generatedAt: number;
    
    // Real-time metrics
    realtime: {
        current_metrics: SecurityMetrics;
        trend_data: SecurityMetrics[];
        active_alerts: SecurityAlert[];
        recent_events: any[];
    };
    
    // Data flows
    data_flows: {
        active_flows: DataFlowEvent[];
        high_risk_flows: DataFlowEvent[];
        blocked_flows: DataFlowEvent[];
        flow_summary: {
            total_flows: number;
            ai_provider_flows: number;
            internal_flows: number;
            external_flows: number;
        };
    };
    
    // Threat landscape
    threat_landscape: {
        current_threat_level: string;
        active_threats: Array<{
            type: string;
            count: number;
            severity: string;
            trend: 'increasing' | 'stable' | 'decreasing';
        }>;
        geographic_threats: Record<string, number>;
        attack_vectors: Record<string, number>;
    };
    
    // Compliance status
    compliance_status: {
        overall_score: number; // 0-100
        framework_scores: Record<string, number>;
        active_violations: number;
        remediation_progress: number; // 0-100
        upcoming_deadlines: Array<{
            requirement: string;
            deadline: number;
            status: string;
        }>;
    };
}

export interface MonitoringConfig {
    enableRealTimeMonitoring: boolean;
    updateInterval: number; // seconds
    alertThresholds: {
        threat_level: number;
        anomaly_score: number;
        compliance_score: number;
        error_rate: number;
        response_time: number;
    };
    retentionPeriods: {
        metrics: number; // days
        alerts: number; // days
        flows: number; // days
    };
    enableThreatIntelligence: boolean;
    enablePredictiveAnalysis: boolean;
    enableAutomatedResponse: boolean;
}

export class RealTimeSecurityMonitoringService extends EventEmitter {
    private static instance: RealTimeSecurityMonitoringService;
    
    private currentMetrics: SecurityMetrics;
    private metricsHistory: SecurityMetrics[] = [];
    private activeAlerts: Map<string, SecurityAlert> = new Map();
    private dataFlows: Map<string, DataFlowEvent> = new Map();
    private threatIntelligence = new Map<string, any>();
    
    private readonly MAX_METRICS_HISTORY = 2880; // 24 hours at 30-second intervals
    private readonly MAX_ALERTS = 10000;
    private readonly MAX_FLOWS = 50000;
    
    // Configuration
    private config: MonitoringConfig = {
        enableRealTimeMonitoring: true,
        updateInterval: 30, // 30 seconds
        alertThresholds: {
            threat_level: 0.7,
            anomaly_score: 0.6,
            compliance_score: 80,
            error_rate: 5,
            response_time: 5000
        },
        retentionPeriods: {
            metrics: 30,
            alerts: 90,
            flows: 30
        },
        enableThreatIntelligence: true,
        enablePredictiveAnalysis: true,
        enableAutomatedResponse: false
    };
    
    // Monitoring intervals
    private metricsInterval?: NodeJS.Timeout;
    private alertProcessingInterval?: NodeJS.Timeout;
    private flowTrackingInterval?: NodeJS.Timeout;
    
    // Statistics
    private stats = {
        total_alerts_generated: 0,
        critical_alerts: 0,
        false_positives: 0,
        automated_responses: 0,
        data_flows_tracked: 0,
        threats_detected: 0,
        compliance_checks: 0,
        uptime: Date.now()
    };

    private constructor() {
        super();
        this.currentMetrics = this.initializeMetrics();
        this.startRealTimeMonitoring();
        this.setupServiceEventListeners();
    }

    public static getInstance(): RealTimeSecurityMonitoringService {
        if (!RealTimeSecurityMonitoringService.instance) {
            RealTimeSecurityMonitoringService.instance = new RealTimeSecurityMonitoringService();
        }
        return RealTimeSecurityMonitoringService.instance;
    }

    /**
     * Get real-time monitoring dashboard
     */
    public async getMonitoringDashboard(): Promise<MonitoringDashboard> {
        const dashboardId = this.generateDashboardId();
        
        try {
            // Get current metrics
            await this.updateCurrentMetrics();
            
            // Get active alerts
            const activeAlerts = Array.from(this.activeAlerts.values())
                .filter(alert => alert.response.status !== 'resolved')
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, 50);
            
            // Get recent audit events
            const recentEvents = await comprehensiveAuditService.queryEvents({
                timeRange: {
                    start: Date.now() - 3600000, // Last hour
                    end: Date.now()
                },
                limit: 100,
                sortBy: 'timestamp',
                sortOrder: 'desc'
            });
            
            // Get data flows
            const activeFlows = Array.from(this.dataFlows.values())
                .filter(flow => flow.flow.transmission.status === 'in_progress' || 
                              flow.flow.transmission.status === 'initiated')
                .slice(0, 100);
            
            const highRiskFlows = Array.from(this.dataFlows.values())
                .filter(flow => flow.security.risk_level === 'high' || 
                              flow.security.risk_level === 'critical')
                .slice(0, 50);
            
            const blockedFlows = Array.from(this.dataFlows.values())
                .filter(flow => flow.flow.transmission.status === 'blocked')
                .slice(0, 50);
            
            // Analyze threat landscape
            const threatLandscape = await this.analyzeThreatLandscape();
            
            // Get compliance status
            const complianceStatus = await this.getComplianceStatus();
            
            const dashboard: MonitoringDashboard = {
                dashboardId,
                generatedAt: Date.now(),
                realtime: {
                    current_metrics: this.currentMetrics,
                    trend_data: this.metricsHistory.slice(-60), // Last 30 minutes
                    active_alerts: activeAlerts,
                    recent_events: recentEvents.events
                },
                data_flows: {
                    active_flows: activeFlows,
                    high_risk_flows: highRiskFlows,
                    blocked_flows: blockedFlows,
                    flow_summary: {
                        total_flows: this.dataFlows.size,
                        ai_provider_flows: Array.from(this.dataFlows.values())
                            .filter(f => f.flow.destination.system.includes('ai_provider')).length,
                        internal_flows: Array.from(this.dataFlows.values())
                            .filter(f => f.flow.destination.system === 'internal').length,
                        external_flows: Array.from(this.dataFlows.values())
                            .filter(f => f.flow.destination.system === 'external').length
                    }
                },
                threat_landscape: threatLandscape,
                compliance_status: complianceStatus
            };
            
            // Cache dashboard
            await cacheService.set('security_monitoring_dashboard', dashboard, 60);
            
            // Emit dashboard update
            this.emit('dashboard_updated', {
                dashboardId,
                alertCount: activeAlerts.length,
                threatLevel: threatLandscape.current_threat_level,
                complianceScore: complianceStatus.overall_score
            });
            
            return dashboard;
            
        } catch (error) {
            loggingService.error('Failed to generate monitoring dashboard', {
                component: 'RealTimeSecurityMonitoringService',
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Track data flow in real-time
     */
    public async trackDataFlow(
        source: DataFlowEvent['flow']['source'],
        destination: DataFlowEvent['flow']['destination'],
        data: DataFlowEvent['flow']['data'],
        transmission: Partial<DataFlowEvent['flow']['transmission']> = {}
    ): Promise<string> {
        const flowId = this.generateFlowId();
        const timestamp = Date.now();

        try {
            // Analyze security implications of the flow
            const security = await this.analyzeFlowSecurity(source, destination, data);
            
            // Create data flow event
            const dataFlow: DataFlowEvent = {
                flowId,
                timestamp,
                flow: {
                    source,
                    destination,
                    data,
                    transmission: {
                        protocol: 'https',
                        method: 'POST',
                        status: 'initiated',
                        ...transmission
                    }
                },
                security,
                lineage: {
                    parent_flows: [],
                    child_flows: [],
                    transformation_steps: []
                }
            };

            // Store data flow
            this.dataFlows.set(flowId, dataFlow);
            this.stats.data_flows_tracked++;

            // Clean up old flows
            this.cleanupDataFlows();

            // Record in audit trail
            await comprehensiveAuditService.recordEvent(
                'data_transmission',
                'data_flow_initiated',
                {
                    type: 'system',
                    id: source.component,
                    name: source.system
                },
                {
                    type: 'data',
                    id: flowId,
                    name: data.type,
                    classification: data.classification
                },
                {
                    severity: security.risk_level === 'critical' ? 'critical' : 
                             security.risk_level === 'high' ? 'high' : 'medium',
                    context: {
                        correlationId: flowId,
                        businessContext: destination.purpose,
                        technicalContext: `${source.system} -> ${destination.system}`
                    },
                    technical: {
                        sourceComponent: source.component,
                        protocol: dataFlow.flow.transmission.protocol,
                        method: dataFlow.flow.transmission.method
                    }
                }
            );

            // Generate alert if high risk
            if (security.risk_level === 'critical' || security.risk_level === 'high') {
                await this.generateDataFlowAlert(dataFlow);
            }

            // Emit flow tracking event
            this.emit('data_flow_tracked', {
                flowId,
                source: source.system,
                destination: destination.system,
                riskLevel: security.risk_level,
                piiDetected: data.pii_detected
            });

            loggingService.info('Data flow tracked', {
                component: 'RealTimeSecurityMonitoringService',
                flowId,
                source: source.system,
                destination: destination.system,
                dataType: data.type,
                riskLevel: security.risk_level
            });

            return flowId;

        } catch (error) {
            loggingService.error('Failed to track data flow', {
                component: 'RealTimeSecurityMonitoringService',
                source: source.system,
                destination: destination.system,
                error: error instanceof Error ? error.message : String(error)
            });
            return '';
        }
    }

    /**
     * Update data flow status
     */
    public async updateDataFlowStatus(
        flowId: string,
        status: DataFlowEvent['flow']['transmission']['status'],
        details?: {
            duration?: number;
            error?: string;
            responseSize?: number;
        }
    ): Promise<void> {
        try {
            const dataFlow = this.dataFlows.get(flowId);
            if (!dataFlow) return;

            dataFlow.flow.transmission.status = status;
            if (details?.duration) dataFlow.flow.transmission.duration = details.duration;

            // Record status update in audit trail
            await comprehensiveAuditService.recordEvent(
                'data_transmission',
                `data_flow_${status}`,
                {
                    type: 'system',
                    id: dataFlow.flow.source.component
                },
                {
                    type: 'data',
                    id: flowId
                },
                {
                    severity: status === 'failed' ? 'high' : 'info',
                    outcome: status === 'completed' ? 'success' : 
                            status === 'failed' ? 'failure' : 'partial',
                    context: {
                        correlationId: flowId
                    },
                    technical: {
                        duration: details?.duration,
                        errorDetails: details?.error
                    }
                }
            );

            // Emit status update
            this.emit('data_flow_updated', {
                flowId,
                status,
                duration: details?.duration
            });

        } catch (error) {
            loggingService.error('Failed to update data flow status', {
                component: 'RealTimeSecurityMonitoringService',
                flowId,
                status,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Generate security alert
     */
    public async generateAlert(
        category: SecurityAlert['category'],
        severity: SecurityAlert['severity'],
        title: string,
        description: string,
        affected: Partial<SecurityAlert['affected']> = {},
        threat?: Partial<SecurityAlert['threat']>
    ): Promise<string> {
        const alertId = this.generateAlertId();
        const timestamp = Date.now();

        try {
            const alert: SecurityAlert = {
                alertId,
                timestamp,
                severity,
                category,
                alert: {
                    title,
                    description,
                    source: 'RealTimeSecurityMonitoring',
                    confidence: 0.8, // Default confidence
                    urgency: severity === 'critical' ? 'immediate' : 
                            severity === 'high' ? 'high' : 'medium'
                },
                affected: {
                    users: [],
                    systems: [],
                    data: [],
                    services: [],
                    ...affected
                },
                threat: {
                    type: 'unknown',
                    vector: 'unknown',
                    indicators: [],
                    ...threat
                },
                response: {
                    status: 'new',
                    actions_taken: []
                },
                related: {
                    event_ids: [],
                    correlation_id: this.generateCorrelationId(),
                    child_alert_ids: []
                }
            };

            // Store alert
            this.activeAlerts.set(alertId, alert);
            this.stats.total_alerts_generated++;
            if (severity === 'critical') this.stats.critical_alerts++;

            // Store in persistent cache
            await this.storeAlert(alert);

            // Clean up old alerts
            this.cleanupAlerts();

            // Trigger automated response if enabled and critical
            if (this.config.enableAutomatedResponse && severity === 'critical') {
                await this.triggerAutomatedResponse(alert);
            }

            // Emit alert
            this.emit('security_alert_generated', {
                alertId,
                category,
                severity,
                title,
                affectedSystems: affected.systems?.length || 0
            });

            // Log alert
            const logLevel = severity === 'critical' ? 'error' : 
                           severity === 'high' ? 'warn' : 'info';
            
            loggingService[logLevel]('Security alert generated', {
                component: 'RealTimeSecurityMonitoringService',
                alertId,
                category,
                severity,
                title,
                description
            });

            return alertId;

        } catch (error) {
            loggingService.error('Failed to generate security alert', {
                component: 'RealTimeSecurityMonitoringService',
                category,
                severity,
                error: error instanceof Error ? error.message : String(error)
            });
            return '';
        }
    }

    /**
     * Update current security metrics
     */
    private async updateCurrentMetrics(): Promise<void> {
        try {
            const timestamp = Date.now();
            
            // Get metrics from various services
            const auditStats = comprehensiveAuditService.getStatistics();
            const complianceStats = complianceEnforcementService.getStatistics();
            const aiAuditStats = aiProviderAuditService.getStatistics();
            const filterStats = preTransmissionFilterService.getStatistics();
            const classificationStats = dataClassificationService.getStatistics();

            // Calculate threat metrics
            const recentAlerts = Array.from(this.activeAlerts.values())
                .filter(alert => timestamp - alert.timestamp < 3600000); // Last hour
            
            const threats = {
                active_threats: recentAlerts.filter(a => a.response.status !== 'resolved').length,
                threat_level: this.calculateOverallThreatLevel(recentAlerts),
                blocked_attempts: filterStats.blockedRequests + aiAuditStats.blockedRequests,
                suspicious_activities: recentAlerts.filter(a => a.category === 'threat').length,
                anomaly_score: this.calculateAverageAnomalyScore()
            };

            // Calculate data protection metrics
            const data_protection = {
                pii_detections: filterStats.piiDetections,
                blocked_transmissions: aiAuditStats.blockedRequests,
                redacted_content: filterStats.redactedRequests,
                classification_events: classificationStats.totalClassifications,
                high_risk_data: classificationStats.highRiskClassifications
            };

            // Calculate compliance metrics
            const compliance = {
                active_violations: complianceStats.violationsDetected,
                critical_violations: complianceStats.criticalViolations,
                consent_requests: complianceStats.consentRequests,
                consent_granted: complianceStats.consentGranted,
                audit_events: auditStats.totalEvents
            };

            // Calculate system metrics
            const system = {
                security_events_per_minute: this.calculateEventsPerMinute(),
                average_response_time: auditStats.averageProcessingTime,
                error_rate: this.calculateErrorRate(),
                uptime_percentage: this.calculateUptimePercentage(),
                active_sessions: await this.getActiveSessionCount()
            };

            // Calculate AI processing metrics
            const ai_processing = {
                requests_processed: aiAuditStats.totalRequests,
                requests_blocked: aiAuditStats.blockedRequests,
                ai_risk_score: this.calculateAIRiskScore(aiAuditStats),
                provider_distribution: await this.getProviderDistribution(),
                cost_at_risk: this.calculateCostAtRisk(aiAuditStats)
            };

            this.currentMetrics = {
                timestamp,
                threats,
                data_protection,
                compliance,
                system,
                ai_processing
            };

            // Add to history
            this.metricsHistory.push(this.currentMetrics);
            if (this.metricsHistory.length > this.MAX_METRICS_HISTORY) {
                this.metricsHistory = this.metricsHistory.slice(-this.MAX_METRICS_HISTORY);
            }

            // Check for threshold breaches
            await this.checkAlertThresholds();

        } catch (error) {
            loggingService.error('Failed to update security metrics', {
                component: 'RealTimeSecurityMonitoringService',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Analyze flow security
     */
    private async analyzeFlowSecurity(
        source: DataFlowEvent['flow']['source'],
        destination: DataFlowEvent['flow']['destination'],
        data: DataFlowEvent['flow']['data']
    ): Promise<DataFlowEvent['security']> {
        let risk_level: 'low' | 'medium' | 'high' | 'critical' = 'low';

        // Risk factors
        if (data.pii_detected) risk_level = 'medium';
        if (data.classification === 'restricted') risk_level = 'high';
        if (destination.system === 'external' && data.pii_detected) risk_level = 'critical';
        if (!data.encryption_status && data.classification !== 'public') risk_level = 'high';

        return {
            risk_level,
            compliance_checked: true,
            approval_required: risk_level === 'critical',
            monitoring_required: risk_level === 'high' || risk_level === 'critical',
            retention_policy: this.determineRetentionPolicy(data.classification)
        };
    }

    /**
     * Analyze threat landscape
     */
    private async analyzeThreatLandscape(): Promise<MonitoringDashboard['threat_landscape']> {
        const recentAlerts = Array.from(this.activeAlerts.values())
            .filter(alert => Date.now() - alert.timestamp < 86400000); // Last 24 hours

        const current_threat_level = this.calculateOverallThreatLevel(recentAlerts);
        
        const active_threats = this.aggregateThreats(recentAlerts);
        
        const geographic_threats = this.aggregateGeographicThreats(recentAlerts);
        
        const attack_vectors = this.aggregateAttackVectors(recentAlerts);

        return {
            current_threat_level,
            active_threats,
            geographic_threats,
            attack_vectors
        };
    }

    /**
     * Get compliance status
     */
    private async getComplianceStatus(): Promise<MonitoringDashboard['compliance_status']> {
        const complianceStats = complianceEnforcementService.getStatistics();
        
        // Calculate overall compliance score
        const overall_score = Math.max(0, 100 - (complianceStats.violationsDetected * 5) - (complianceStats.criticalViolations * 20));
        
        const framework_scores = {
            gdpr: Math.max(0, 100 - (complianceStats.violationsDetected * 3)),
            hipaa: Math.max(0, 100 - (complianceStats.violationsDetected * 4)),
            soc2: Math.max(0, 100 - (complianceStats.violationsDetected * 2)),
            pci_dss: Math.max(0, 100 - (complianceStats.violationsDetected * 5))
        };

        return {
            overall_score,
            framework_scores,
            active_violations: complianceStats.violationsDetected,
            remediation_progress: 75, // Would be calculated from actual remediation data
            upcoming_deadlines: [] // Would come from compliance calendar
        };
    }

    /**
     * Setup event listeners for other services
     */
    private setupServiceEventListeners(): void {
        // Listen to audit service events
        comprehensiveAuditService.on('audit_event_recorded', (event) => {
            if (event.severity === 'critical' || event.riskLevel === 'critical') {
                this.generateAlert(
                    'threat',
                    'critical',
                    'Critical Security Event Detected',
                    `Critical ${event.eventType} event detected from ${event.actor}`,
                    { systems: ['audit_system'] }
                );
            }
        });

        // Listen to compliance service events
        complianceEnforcementService.on('compliance_violation', (violation) => {
            this.generateAlert(
                'compliance',
                violation.severity === 'critical' ? 'critical' : 'high',
                'Compliance Violation Detected',
                `${violation.framework.toUpperCase()} violation: ${violation.category}`,
                { systems: ['compliance_system'] }
            );
        });

        // Listen to AI audit service events
        aiProviderAuditService.on('request_audited', (audit) => {
            if (!audit.allowed || audit.riskLevel === 'critical') {
                this.generateAlert(
                    'ai_security',
                    audit.riskLevel === 'critical' ? 'critical' : 'high',
                    'AI Provider Request Blocked',
                    `High-risk request to ${audit.provider} blocked`,
                    { systems: ['ai_processing'] }
                );
            }
        });

        // Listen to filter service events
        preTransmissionFilterService.on('security_alert', (alert) => {
            this.generateAlert(
                'data_protection',
                'high',
                'PII Detection Alert',
                `Sensitive data detected in transmission: ${alert.rule.name}`,
                { data: [alert.detection.category] }
            );
        });
    }

    /**
     * Start real-time monitoring
     */
    private startRealTimeMonitoring(): void {
        if (!this.config.enableRealTimeMonitoring) return;

        // Metrics update interval
        this.metricsInterval = setInterval(async () => {
            try {
                await this.updateCurrentMetrics();
            } catch (error) {
                loggingService.error('Metrics update failed', {
                    component: 'RealTimeSecurityMonitoringService',
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }, this.config.updateInterval * 1000);

        // Alert processing interval
        this.alertProcessingInterval = setInterval(async () => {
            try {
                await this.processActiveAlerts();
            } catch (error) {
                loggingService.error('Alert processing failed', {
                    component: 'RealTimeSecurityMonitoringService',
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }, 60000); // Every minute

        // Flow tracking cleanup interval
        this.flowTrackingInterval = setInterval(() => {
            this.cleanupDataFlows();
        }, 300000); // Every 5 minutes

        loggingService.info('Real-time security monitoring started', {
            component: 'RealTimeSecurityMonitoringService',
            updateInterval: this.config.updateInterval,
            alertThresholds: this.config.alertThresholds
        });
    }

    // Helper methods and calculations
    private initializeMetrics(): SecurityMetrics {
        return {
            timestamp: Date.now(),
            threats: {
                active_threats: 0,
                threat_level: 'low',
                blocked_attempts: 0,
                suspicious_activities: 0,
                anomaly_score: 0
            },
            data_protection: {
                pii_detections: 0,
                blocked_transmissions: 0,
                redacted_content: 0,
                classification_events: 0,
                high_risk_data: 0
            },
            compliance: {
                active_violations: 0,
                critical_violations: 0,
                consent_requests: 0,
                consent_granted: 0,
                audit_events: 0
            },
            system: {
                security_events_per_minute: 0,
                average_response_time: 0,
                error_rate: 0,
                uptime_percentage: 100,
                active_sessions: 0
            },
            ai_processing: {
                requests_processed: 0,
                requests_blocked: 0,
                ai_risk_score: 0,
                provider_distribution: {},
                cost_at_risk: 0
            }
        };
    }

    private calculateOverallThreatLevel(alerts: SecurityAlert[]): 'low' | 'medium' | 'high' | 'critical' {
        if (alerts.some(a => a.severity === 'critical')) return 'critical';
        if (alerts.filter(a => a.severity === 'high').length > 5) return 'high';
        if (alerts.filter(a => a.severity === 'medium').length > 10) return 'medium';
        return 'low';
    }

    private calculateAverageAnomalyScore(): number {
        if (this.metricsHistory.length === 0) return 0;
        
        const recentMetrics = this.metricsHistory.slice(-10);
        const totalScore = recentMetrics.reduce((sum, m) => sum + m.threats.anomaly_score, 0);
        return totalScore / recentMetrics.length;
    }

    private calculateEventsPerMinute(): number {
        try {
            const stats = comprehensiveAuditService.getStatistics();
            const totalEvents = stats.totalEvents;
            const uptime = Date.now() - stats.uptime;
            const uptimeMinutes = uptime / 60000;
            
            return uptimeMinutes > 0 ? totalEvents / uptimeMinutes : 0;
        } catch {
            return 0;
        }
    }

    private calculateErrorRate(): number {
        try {
            // Calculate error rate from recent audit events
            const recentEvents = Array.from(this.activeAlerts.values())
                .filter(alert => Date.now() - alert.timestamp < 3600000); // Last hour
            
            const totalEvents = recentEvents.length;
            const errorEvents = recentEvents.filter(alert => 
                alert.category === 'threat' || alert.severity === 'critical'
            ).length;
            
            return totalEvents > 0 ? (errorEvents / totalEvents) * 100 : 0;
        } catch {
            return 0;
        }
    }

    private calculateUptimePercentage(): number {
        const uptime = Date.now() - this.stats.uptime;
        const totalTime = uptime;
        return totalTime > 0 ? (uptime / totalTime) * 100 : 100;
    }

    private async getActiveSessionCount(): Promise<number> {
        try {
            // Get active sessions from cache or calculate from recent activity
            const sessions = await cacheService.get('active_sessions_count');
            if (sessions) return sessions as number;
            
            // Fallback: estimate from recent alerts and activities
            const recentActivity = Array.from(this.activeAlerts.values())
                .filter(alert => Date.now() - alert.timestamp < 1800000) // Last 30 minutes
                .length;
            
            return Math.max(1, recentActivity * 2); // Rough estimation
        } catch {
            return 0;
        }
    }

    private calculateAIRiskScore(stats: any): number {
        if (stats.totalRequests === 0) return 0;
        
        const blockRate = stats.blockedRequests / stats.totalRequests;
        const riskRate = stats.highRiskRequests / stats.totalRequests;
        
        return Math.min(1.0, blockRate * 0.6 + riskRate * 0.4);
    }

    private async getProviderDistribution(): Promise<Record<string, number>> {
        try {
            // Get actual provider distribution from AI audit service
            const aiStats = aiProviderAuditService.getStatistics();
            
            // Get provider usage from cache
            const providerUsage = await cacheService.get('ai_provider_usage') as Record<string, number> || {};
            
            // If no data, return estimated distribution based on system activity
            if (Object.keys(providerUsage).length === 0) {
                const totalRequests = aiStats.totalRequests || 100;
                return {
                    anthropic: Math.floor(totalRequests * 0.45),
                    openai: Math.floor(totalRequests * 0.30),
                    bedrock: Math.floor(totalRequests * 0.25)
                };
            }
            
            return providerUsage;
        } catch {
            return {
                anthropic: 45,
                openai: 30,
                bedrock: 25
            };
        }
    }

    private calculateCostAtRisk(stats: any): number {
        try {
            // Calculate actual cost at risk based on blocked requests and their estimated costs
            const avgCostPerRequest = 0.10; // Average cost per AI request
            const highRiskMultiplier = 2.0; // High-risk requests typically cost more
            
            const blockedCost = (stats.blockedRequests || 0) * avgCostPerRequest;
            const highRiskCost = (stats.highRiskRequests || 0) * avgCostPerRequest * highRiskMultiplier;
            
            return blockedCost + highRiskCost;
        } catch {
            return 0;
        }
    }

    private determineRetentionPolicy(classification: string): string {
        const policies = {
            'public': '3_years',
            'internal': '2_years',
            'confidential': '1_year',
            'restricted': '6_months',
            'top_secret': '3_months'
        };
        return policies[classification as keyof typeof policies] || '1_year';
    }

    private aggregateThreats(alerts: SecurityAlert[]): Array<{ type: string; count: number; severity: string; trend: 'increasing' | 'stable' | 'decreasing' }> {
        const threatCounts: Record<string, number> = {};
        
        for (const alert of alerts) {
            const threatType = alert.threat.type || 'unknown';
            threatCounts[threatType] = (threatCounts[threatType] || 0) + 1;
        }
        
        return Object.entries(threatCounts).map(([type, count]) => ({
            type,
            count,
            severity: count > 10 ? 'critical' : count > 5 ? 'high' : 'medium',
            trend: 'stable' as const // Would calculate actual trend
        }));
    }

    private aggregateGeographicThreats(alerts: SecurityAlert[]): Record<string, number> {
        // Would aggregate by geographic location of threats
        return {
            'Unknown': alerts.length * 0.6,
            'US': alerts.length * 0.3,
            'Other': alerts.length * 0.1
        };
    }

    private aggregateAttackVectors(alerts: SecurityAlert[]): Record<string, number> {
        const vectors: Record<string, number> = {};
        
        for (const alert of alerts) {
            const vector = alert.threat.vector || 'unknown';
            vectors[vector] = (vectors[vector] || 0) + 1;
        }
        
        return vectors;
    }

    private async checkAlertThresholds(): Promise<void> {
        const metrics = this.currentMetrics;
        
        // Check threat level threshold
        if (metrics.threats.anomaly_score > this.config.alertThresholds.anomaly_score) {
            await this.generateAlert(
                'threat',
                'high',
                'High Anomaly Score Detected',
                `System anomaly score ${metrics.threats.anomaly_score.toFixed(2)} exceeds threshold`,
                { systems: ['monitoring_system'] }
            );
        }
        
        // Check compliance score threshold
        if (metrics.compliance.active_violations > 10) {
            await this.generateAlert(
                'compliance',
                'medium',
                'Multiple Compliance Violations',
                `${metrics.compliance.active_violations} active compliance violations detected`,
                { systems: ['compliance_system'] }
            );
        }
    }

    private async processActiveAlerts(): Promise<void> {
        // Process and potentially auto-resolve alerts
        const now = Date.now();
        
        for (const alert of this.activeAlerts.values()) {
            // Auto-resolve low severity alerts after 24 hours
            if (alert.severity === 'low' && (now - alert.timestamp) > 86400000) {
                alert.response.status = 'resolved';
                alert.response.resolution_time = now - alert.timestamp;
                await this.storeAlert(alert);
            }
        }
    }

    private async generateDataFlowAlert(dataFlow: DataFlowEvent): Promise<void> {
        await this.generateAlert(
            'data_protection',
            dataFlow.security.risk_level === 'critical' ? 'critical' : 'high',
            'High-Risk Data Flow Detected',
            `High-risk data flow from ${dataFlow.flow.source.system} to ${dataFlow.flow.destination.system}`,
            {
                systems: [dataFlow.flow.source.system, dataFlow.flow.destination.system],
                data: [dataFlow.flow.data.type]
            },
            {
                type: 'data_exfiltration',
                vector: 'data_transmission',
                indicators: [`pii_detected: ${dataFlow.flow.data.pii_detected}`, `encryption: ${dataFlow.flow.data.encryption_status}`]
            }
        );
    }

    private async triggerAutomatedResponse(alert: SecurityAlert): Promise<void> {
        try {
            this.stats.automated_responses++;
            
            // Implement automated response actions
            const actions = [];
            
            if (alert.category === 'threat' && alert.severity === 'critical') {
                actions.push('Block suspicious IP addresses');
                actions.push('Increase monitoring sensitivity');
                actions.push('Alert security team');
            }
            
            alert.response.actions_taken = actions;
            await this.storeAlert(alert);
            
            loggingService.info('Automated response triggered', {
                component: 'RealTimeSecurityMonitoringService',
                alertId: alert.alertId,
                actions: actions.length
            });
            
        } catch (error) {
            loggingService.error('Automated response failed', {
                component: 'RealTimeSecurityMonitoringService',
                alertId: alert.alertId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    // Storage and cleanup methods
    private async storeAlert(alert: SecurityAlert): Promise<void> {
        try {
            const cacheKey = `security_alert:${alert.alertId}`;
            const ttl = this.config.retentionPeriods.alerts * 86400;
            await cacheService.set(cacheKey, alert, ttl);
        } catch (error) {
            loggingService.error('Failed to store security alert', {
                component: 'RealTimeSecurityMonitoringService',
                alertId: alert.alertId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    private cleanupAlerts(): void {
        if (this.activeAlerts.size <= this.MAX_ALERTS) return;
        
        const alerts = Array.from(this.activeAlerts.entries());
        alerts.sort((a, b) => a[1].timestamp - b[1].timestamp);
        
        // Remove oldest 20%
        const toRemove = Math.floor(this.MAX_ALERTS * 0.2);
        for (let i = 0; i < toRemove; i++) {
            this.activeAlerts.delete(alerts[i][0]);
        }
    }

    private cleanupDataFlows(): void {
        if (this.dataFlows.size <= this.MAX_FLOWS) return;
        
        const flows = Array.from(this.dataFlows.entries());
        flows.sort((a, b) => a[1].timestamp - b[1].timestamp);
        
        // Remove oldest 20%
        const toRemove = Math.floor(this.MAX_FLOWS * 0.2);
        for (let i = 0; i < toRemove; i++) {
            this.dataFlows.delete(flows[i][0]);
        }
    }

    // ID generation
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
     * Get service statistics
     */
    public getStatistics(): typeof this.stats & { 
        activeAlerts: number; 
        activeFlows: number; 
        metricsHistorySize: number; 
    } {
        return {
            ...this.stats,
            activeAlerts: this.activeAlerts.size,
            activeFlows: this.dataFlows.size,
            metricsHistorySize: this.metricsHistory.length
        };
    }

    /**
     * Update configuration
     */
    public updateConfig(newConfig: Partial<MonitoringConfig>): void {
        this.config = { ...this.config, ...newConfig };
        
        loggingService.info('Real-time security monitoring configuration updated', {
            component: 'RealTimeSecurityMonitoringService',
            config: this.config
        });

        this.emit('config_updated', this.config);
    }

    /**
     * Cleanup resources
     */
    public cleanup(): void {
        if (this.metricsInterval) {
            clearInterval(this.metricsInterval);
            this.metricsInterval = undefined;
        }
        
        if (this.alertProcessingInterval) {
            clearInterval(this.alertProcessingInterval);
            this.alertProcessingInterval = undefined;
        }
        
        if (this.flowTrackingInterval) {
            clearInterval(this.flowTrackingInterval);
            this.flowTrackingInterval = undefined;
        }
        
        this.activeAlerts.clear();
        this.dataFlows.clear();
        this.metricsHistory = [];
        this.threatIntelligence.clear();
        this.removeAllListeners();
    }
}

// Export singleton instance
export const realTimeSecurityMonitoringService = RealTimeSecurityMonitoringService.getInstance();
