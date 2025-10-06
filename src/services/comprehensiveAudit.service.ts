import { loggingService } from './logging.service';
import { cacheService } from './cache.service';
import { EventEmitter } from 'events';
import * as crypto from 'crypto';

/**
 * Comprehensive Audit Trail Service
 * Complete audit system for security reviews and compliance reporting
 */

export type AuditEventType = 
    | 'data_access' | 'data_modification' | 'data_deletion' | 'data_transmission'
    | 'user_authentication' | 'user_authorization' | 'permission_change'
    | 'system_configuration' | 'security_event' | 'compliance_check'
    | 'ai_processing' | 'api_call' | 'file_upload' | 'report_generation'
    | 'backup_creation' | 'backup_restoration' | 'system_maintenance';

export type AuditSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface AuditEvent {
    eventId: string;
    timestamp: number;
    eventType: AuditEventType;
    severity: AuditSeverity;
    
    // Event details
    event: {
        action: string;
        description: string;
        outcome: 'success' | 'failure' | 'partial' | 'blocked';
        category: string;
        subcategory?: string;
    };
    
    // Actor information
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
    
    // Target/Resource information
    target: {
        type: 'user' | 'data' | 'file' | 'system' | 'service' | 'configuration';
        id: string;
        name?: string;
        classification?: string;
        sensitivity?: string;
        owner?: string;
        metadata?: Record<string, any>;
    };
    
    // Context information
    context: {
        requestId?: string;
        correlationId?: string;
        parentEventId?: string;
        businessContext?: string;
        technicalContext?: string;
        complianceFramework?: string[];
        dataLineage?: DataLineageInfo;
    };
    
    // Security analysis
    security: {
        riskLevel: 'low' | 'medium' | 'high' | 'critical';
        securityImplications: string[];
        complianceImplications: string[];
        privacyImplications: string[];
        anomalyScore: number; // 0-1, higher = more anomalous
        threatIndicators: string[];
    };
    
    // Technical details
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
    
    // Evidence and artifacts
    evidence: {
        beforeState?: string;
        afterState?: string;
        changeDetails?: string;
        artifacts?: string[];
        screenshots?: string[];
        logs?: string[];
        checksums?: Record<string, string>;
    };
}

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

export interface AuditQuery {
    eventTypes?: AuditEventType[];
    severity?: AuditSeverity[];
    actorIds?: string[];
    targetIds?: string[];
    timeRange?: { start: number; end: number };
    riskLevel?: string[];
    complianceFrameworks?: string[];
    outcomes?: string[];
    searchText?: string;
    correlationId?: string;
    limit?: number;
    offset?: number;
    sortBy?: 'timestamp' | 'severity' | 'risk_level';
    sortOrder?: 'asc' | 'desc';
}

export interface AuditReport {
    reportId: string;
    generatedAt: number;
    generatedBy: string;
    reportType: 'security_review' | 'compliance_audit' | 'incident_investigation' | 'data_lineage' | 'access_review';
    
    // Report parameters
    parameters: {
        timeRange: { start: number; end: number };
        scope: string[];
        frameworks: string[];
        includeEvidence: boolean;
        includeRecommendations: boolean;
    };
    
    // Summary statistics
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
    
    // Detailed findings
    findings: {
        securityFindings: Array<{
            type: string;
            severity: string;
            description: string;
            events: string[];
            riskLevel: string;
            recommendations: string[];
        }>;
        complianceFindings: Array<{
            framework: string;
            requirement: string;
            status: 'compliant' | 'non_compliant' | 'partial';
            evidence: string[];
            gaps: string[];
            remediation: string[];
        }>;
        anomalies: Array<{
            type: string;
            description: string;
            events: string[];
            score: number;
            investigation: string;
        }>;
        dataLineage: Array<{
            dataId: string;
            source: string;
            transformations: number;
            destinations: string[];
            retentionStatus: string;
        }>;
    };
    
    // Recommendations
    recommendations: {
        immediate: string[];
        shortTerm: string[];
        longTerm: string[];
        compliance: string[];
        security: string[];
    };
}

export interface AuditConfig {
    enableComprehensiveAuditing: boolean;
    retentionPeriod: number; // days
    enableRealTimeAnalysis: boolean;
    enableAnomalyDetection: boolean;
    enableDataLineageTracking: boolean;
    enableAutomatedReporting: boolean;
    compressionEnabled: boolean;
    encryptionEnabled: boolean;
    maxEventSize: number; // bytes
    batchSize: number;
    flushInterval: number; // seconds
}

export class ComprehensiveAuditService extends EventEmitter {
    private static instance: ComprehensiveAuditService;
    
    private auditEvents: Map<string, AuditEvent> = new Map();
    private eventBuffer: AuditEvent[] = [];
    private dataLineageMap = new Map<string, DataLineageInfo>();
    private anomalyBaselines = new Map<string, number>();
    
    private readonly MAX_CACHE_SIZE = 100000;
    private readonly MAX_BUFFER_SIZE = 1000;
    
    // Configuration
    private config: AuditConfig = {
        enableComprehensiveAuditing: true,
        retentionPeriod: 2555, // 7 years for compliance
        enableRealTimeAnalysis: true,
        enableAnomalyDetection: true,
        enableDataLineageTracking: true,
        enableAutomatedReporting: false,
        compressionEnabled: true,
        encryptionEnabled: true,
        maxEventSize: 1048576, // 1MB
        batchSize: 100,
        flushInterval: 30 // 30 seconds
    };
    
    // Statistics
    private stats = {
        totalEvents: 0,
        securityEvents: 0,
        complianceEvents: 0,
        anomalousEvents: 0,
        dataLineageEvents: 0,
        averageEventSize: 0,
        averageProcessingTime: 0,
        uptime: Date.now()
    };
    
    // Monitoring
    private flushInterval?: NodeJS.Timeout;
    private anomalyDetectionInterval?: NodeJS.Timeout;

    private constructor() {
        super();
        this.startEventProcessing();
        this.startAnomalyDetection();
    }

    public static getInstance(): ComprehensiveAuditService {
        if (!ComprehensiveAuditService.instance) {
            ComprehensiveAuditService.instance = new ComprehensiveAuditService();
        }
        return ComprehensiveAuditService.instance;
    }

    /**
     * Record comprehensive audit event
     */
    public async recordEvent(
        eventType: AuditEventType,
        action: string,
        actor: Partial<AuditEvent['actor']>,
        target: Partial<AuditEvent['target']>,
        options: {
            severity?: AuditSeverity;
            outcome?: AuditEvent['event']['outcome'];
            description?: string;
            context?: Partial<AuditEvent['context']>;
            evidence?: Partial<AuditEvent['evidence']>;
            technical?: Partial<AuditEvent['technical']>;
        } = {}
    ): Promise<string> {
        if (!this.config.enableComprehensiveAuditing) {
            return '';
        }

        const eventId = this.generateEventId();
        const timestamp = Date.now();
        const startTime = timestamp;

        try {
            // Perform security analysis
            const securityAnalysis = await this.analyzeEventSecurity(eventType, action, actor, target, options);
            
            // Track data lineage if applicable
            const dataLineage = this.config.enableDataLineageTracking && target.type === 'data' 
                ? await this.trackDataLineage(target.id!, action, actor.id!, options.context)
                : undefined;

            // Create comprehensive audit event
            const auditEvent: AuditEvent = {
                eventId,
                timestamp,
                eventType,
                severity: options.severity || this.determineSeverity(eventType, securityAnalysis.riskLevel),
                event: {
                    action,
                    description: options.description || `${action} performed on ${target.type || 'unknown'}`,
                    outcome: options.outcome || 'success',
                    category: this.categorizeEvent(eventType),
                    subcategory: this.subcategorizeEvent(eventType, action)
                },
                actor: {
                    type: 'user',
                    id: 'unknown',
                    ...actor
                },
                target: {
                    type: 'data',
                    id: 'unknown',
                    ...target
                },
                context: {
                    requestId: this.generateRequestId(),
                    correlationId: this.generateCorrelationId(),
                    ...options.context,
                    dataLineage
                },
                security: securityAnalysis,
                technical: {
                    sourceSystem: 'cost-katana-backend',
                    sourceComponent: 'ComprehensiveAuditService',
                    ...options.technical
                },
                evidence: {
                    ...options.evidence
                }
            };

            // Add to buffer for batch processing
            this.eventBuffer.push(auditEvent);
            
            // Immediate processing for critical events
            if (auditEvent.severity === 'critical' || securityAnalysis.riskLevel === 'critical') {
                await this.processEventImmediate(auditEvent);
            }

            // Update statistics
            this.updateStatistics(auditEvent, Date.now() - startTime);

            // Emit event
            this.emit('audit_event_recorded', {
                eventId,
                eventType,
                severity: auditEvent.severity,
                riskLevel: securityAnalysis.riskLevel,
                actor: actor.id,
                target: target.id
            });

            return eventId;

        } catch (error) {
            loggingService.error('Failed to record audit event', {
                component: 'ComprehensiveAuditService',
                eventType,
                action,
                error: error instanceof Error ? error.message : String(error)
            });
            return '';
        }
    }

    /**
     * Analyze event for security implications
     */
    private async analyzeEventSecurity(
        eventType: AuditEventType,
        action: string,
        actor: Partial<AuditEvent['actor']>,
        target: Partial<AuditEvent['target']>,
        options: any
    ): Promise<AuditEvent['security']> {
        const securityImplications: string[] = [];
        const complianceImplications: string[] = [];
        const privacyImplications: string[] = [];
        const threatIndicators: string[] = [];
        let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
        let anomalyScore = 0;

        // Analyze based on event type
        switch (eventType) {
            case 'data_access':
                if (target.sensitivity === 'high' || target.classification === 'restricted') {
                    riskLevel = 'medium';
                    securityImplications.push('Access to sensitive data');
                    complianceImplications.push('Audit trail required for sensitive data access');
                }
                break;

            case 'data_transmission':
                riskLevel = 'high';
                securityImplications.push('Data transmitted to external system');
                complianceImplications.push('Cross-border data transfer implications');
                privacyImplications.push('Data subject rights may apply');
                break;

            case 'ai_processing':
                riskLevel = 'medium';
                securityImplications.push('Data processed by AI system');
                complianceImplications.push('AI processing transparency requirements');
                privacyImplications.push('Automated decision-making implications');
                break;

            case 'user_authentication':
                if (options.outcome === 'failure') {
                    riskLevel = 'high';
                    threatIndicators.push('Failed authentication attempt');
                    securityImplications.push('Potential unauthorized access attempt');
                }
                break;

            case 'permission_change':
                riskLevel = 'high';
                securityImplications.push('Access control modification');
                complianceImplications.push('Access control audit required');
                break;

            case 'system_configuration':
                riskLevel = 'medium';
                securityImplications.push('System configuration change');
                complianceImplications.push('Configuration change audit required');
                break;

            case 'security_event':
                riskLevel = 'high';
                securityImplications.push('Security event detected');
                threatIndicators.push('Security anomaly');
                break;
        }

        // Calculate anomaly score
        anomalyScore = await this.calculateAnomalyScore(eventType, action, actor, target);

        // Adjust risk based on anomaly score
        if (anomalyScore > 0.8) {
            riskLevel = 'critical';
            threatIndicators.push('High anomaly score detected');
        } else if (anomalyScore > 0.6) {
            riskLevel = Math.max(this.getRiskLevelIndex(riskLevel), this.getRiskLevelIndex('high')) 
                ? 'high' : riskLevel;
            threatIndicators.push('Moderate anomaly detected');
        }

        // Actor-based risk adjustments
        if (actor.type === 'api' && !actor.permissions) {
            threatIndicators.push('API access without explicit permissions');
            riskLevel = 'medium';
        }

        if (actor.location?.country && ['unknown', 'restricted'].includes(actor.location.country)) {
            threatIndicators.push('Access from restricted or unknown location');
            riskLevel = 'medium';
        }

        return {
            riskLevel,
            securityImplications,
            complianceImplications,
            privacyImplications,
            anomalyScore,
            threatIndicators
        };
    }

    /**
     * Track data lineage
     */
    private async trackDataLineage(
        dataId: string,
        action: string,
        actorId: string,
        context?: any
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
                    deleteAfter: Date.now() + (365 * 24 * 60 * 60 * 1000)
                }
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
            outputHash: this.generateDataHash(dataId + action + Date.now() + 'output')
        };
        lineage.transformations.push(transformation);

        // Add destination if this is a transmission
        if (action.includes('transmit') || action.includes('send') || action.includes('export')) {
            const destination = {
                destinationId: context?.destinationId || 'unknown',
                destinationType: context?.destinationType || 'external_service',
                timestamp: Date.now(),
                purpose: context?.purpose || 'processing'
            };
            lineage.destinations.push(destination);
        }

        // Store updated lineage
        await this.storeDataLineage(dataId, lineage);

        return lineage;
    }

    /**
     * Calculate anomaly score for event
     */
    private async calculateAnomalyScore(
        eventType: AuditEventType,
        action: string,
        actor: Partial<AuditEvent['actor']>,
        target: Partial<AuditEvent['target']>
    ): Promise<number> {
        if (!this.config.enableAnomalyDetection) {
            return 0;
        }

        try {
            let anomalyScore = 0;

            // Check frequency anomalies
            const actorKey = `${actor.type}:${actor.id}`;
            const recentEvents = await this.getRecentEvents(actorKey, 3600000); // Last hour
            const eventCount = recentEvents.filter(e => e.eventType === eventType).length;
            
            const baseline = this.anomalyBaselines.get(`${actorKey}:${eventType}`) || 5;
            if (eventCount > baseline * 3) {
                anomalyScore += 0.4; // High frequency anomaly
            } else if (eventCount > baseline * 2) {
                anomalyScore += 0.2; // Moderate frequency anomaly
            }

            // Check time-based anomalies
            const currentHour = new Date().getHours();
            if ((currentHour < 6 || currentHour > 22) && eventType !== 'system_maintenance') {
                anomalyScore += 0.2; // Off-hours activity
            }

            // Check target sensitivity anomalies
            if (target.sensitivity === 'high' && actor.role !== 'admin') {
                anomalyScore += 0.3; // Non-admin accessing high sensitivity data
            }

            // Check action anomalies
            if (action.includes('delete') || action.includes('destroy')) {
                anomalyScore += 0.2; // Destructive actions are inherently risky
            }

            // Check geographic anomalies
            if (actor.location?.country && actor.location.country !== 'US') {
                anomalyScore += 0.1; // International access
            }

            return Math.min(1.0, anomalyScore);

        } catch (error) {
            loggingService.debug('Anomaly score calculation failed', {
                component: 'ComprehensiveAuditService',
                error: error instanceof Error ? error.message : String(error)
            });
            return 0;
        }
    }

    /**
     * Query audit events
     */
    public async queryEvents(query: AuditQuery): Promise<{
        events: AuditEvent[];
        total: number;
        hasMore: boolean;
        aggregations: {
            byType: Record<AuditEventType, number>;
            bySeverity: Record<AuditSeverity, number>;
            byActor: Record<string, number>;
            byRisk: Record<string, number>;
        };
    }> {
        try {
            let events = Array.from(this.auditEvents.values());

            // Apply filters
            if (query.eventTypes && query.eventTypes.length > 0) {
                events = events.filter(e => query.eventTypes!.includes(e.eventType));
            }

            if (query.severity && query.severity.length > 0) {
                events = events.filter(e => query.severity!.includes(e.severity));
            }

            if (query.actorIds && query.actorIds.length > 0) {
                events = events.filter(e => query.actorIds!.includes(e.actor.id));
            }

            if (query.targetIds && query.targetIds.length > 0) {
                events = events.filter(e => query.targetIds!.includes(e.target.id));
            }

            if (query.timeRange) {
                events = events.filter(e => 
                    e.timestamp >= query.timeRange!.start && e.timestamp <= query.timeRange!.end
                );
            }

            if (query.riskLevel && query.riskLevel.length > 0) {
                events = events.filter(e => query.riskLevel!.includes(e.security.riskLevel));
            }

            if (query.correlationId) {
                events = events.filter(e => e.context.correlationId === query.correlationId);
            }

            if (query.searchText) {
                const searchLower = query.searchText.toLowerCase();
                events = events.filter(e => 
                    e.event.description.toLowerCase().includes(searchLower) ||
                    e.event.action.toLowerCase().includes(searchLower) ||
                    e.actor.name?.toLowerCase().includes(searchLower)
                );
            }

            // Sort events
            const sortBy = query.sortBy || 'timestamp';
            const sortOrder = query.sortOrder || 'desc';
            events.sort((a, b) => {
                let aValue: any, bValue: any;
                
                switch (sortBy) {
                    case 'severity':
                        aValue = this.getSeverityIndex(a.severity);
                        bValue = this.getSeverityIndex(b.severity);
                        break;
                    case 'risk_level':
                        aValue = this.getRiskLevelIndex(a.security.riskLevel);
                        bValue = this.getRiskLevelIndex(b.security.riskLevel);
                        break;
                    default:
                        aValue = a.timestamp;
                        bValue = b.timestamp;
                }
                
                return sortOrder === 'asc' ? aValue - bValue : bValue - aValue;
            });

            // Apply pagination
            const offset = query.offset || 0;
            const limit = query.limit || 100;
            const paginatedEvents = events.slice(offset, offset + limit);

            // Calculate aggregations
            const aggregations = {
                byType: this.aggregateByField(events, e => e.eventType),
                bySeverity: this.aggregateByField(events, e => e.severity),
                byActor: this.aggregateByField(events, e => e.actor.id),
                byRisk: this.aggregateByField(events, e => e.security.riskLevel)
            };

            return {
                events: paginatedEvents,
                total: events.length,
                hasMore: offset + limit < events.length,
                aggregations
            };

        } catch (error) {
            loggingService.error('Failed to query audit events', {
                component: 'ComprehensiveAuditService',
                error: error instanceof Error ? error.message : String(error)
            });

            return {
                events: [],
                total: 0,
                hasMore: false,
                aggregations: {
                    byType: {} as any,
                    bySeverity: {} as any,
                    byActor: {} as any,
                    byRisk: {} as any
                }
            };
        }
    }

    /**
     * Generate comprehensive audit report
     */
    public async generateAuditReport(
        reportType: AuditReport['reportType'],
        parameters: AuditReport['parameters'],
        generatedBy: string
    ): Promise<AuditReport> {
        const reportId = this.generateReportId();
        
        try {
            // Query relevant events
            const query: AuditQuery = {
                timeRange: parameters.timeRange,
                limit: 50000 // Large limit for comprehensive report
            };

            const { events, aggregations } = await this.queryEvents(query);

            // Calculate summary statistics
            const summary = {
                totalEvents: events.length,
                eventsByType: aggregations.byType,
                eventsBySeverity: aggregations.bySeverity,
                uniqueActors: new Set(events.map(e => e.actor.id)).size,
                uniqueTargets: new Set(events.map(e => e.target.id)).size,
                securityEvents: events.filter(e => e.eventType === 'security_event').length,
                complianceEvents: events.filter(e => e.eventType === 'compliance_check').length,
                anomalousEvents: events.filter(e => e.security.anomalyScore > 0.6).length,
                failedEvents: events.filter(e => e.event.outcome === 'failure').length
            };

            // Analyze findings based on report type
            const findings = await this.analyzeAuditFindings(reportType, events, parameters);

            // Generate recommendations
            const recommendations = this.generateAuditRecommendations(reportType, findings, summary);

            const report: AuditReport = {
                reportId,
                generatedAt: Date.now(),
                generatedBy,
                reportType,
                parameters,
                summary,
                findings,
                recommendations
            };

            // Store report
            await this.storeAuditReport(report);

            // Emit report event
            this.emit('audit_report_generated', {
                reportId,
                reportType,
                eventCount: summary.totalEvents,
                anomalousEvents: summary.anomalousEvents,
                securityEvents: summary.securityEvents
            });

            loggingService.info('Comprehensive audit report generated', {
                component: 'ComprehensiveAuditService',
                reportId,
                reportType,
                eventCount: summary.totalEvents,
                timeRange: parameters.timeRange
            });

            return report;

        } catch (error) {
            loggingService.error('Failed to generate audit report', {
                component: 'ComprehensiveAuditService',
                reportType,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Get data lineage for specific data item
     */
    public getDataLineage(dataId: string): DataLineageInfo | null {
        return this.dataLineageMap.get(dataId) || null;
    }

    /**
     * Start event processing
     */
    private startEventProcessing(): void {
        this.flushInterval = setInterval(async () => {
            try {
                await this.flushEventBuffer();
            } catch (error) {
                loggingService.error('Event buffer flush failed', {
                    component: 'ComprehensiveAuditService',
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }, this.config.flushInterval * 1000);
    }

    /**
     * Start anomaly detection
     */
    private startAnomalyDetection(): void {
        this.anomalyDetectionInterval = setInterval(async () => {
            try {
                await this.updateAnomalyBaselines();
            } catch (error) {
                loggingService.error('Anomaly detection update failed', {
                    component: 'ComprehensiveAuditService',
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }, 300000); // Every 5 minutes
    }

    /**
     * Flush event buffer to persistent storage
     */
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

            loggingService.debug('Event buffer flushed', {
                component: 'ComprehensiveAuditService',
                eventCount: eventsToFlush.length
            });

        } catch (error) {
            // Put events back in buffer on failure
            this.eventBuffer.unshift(...eventsToFlush);
            throw error;
        }
    }

    /**
     * Process batch of events
     */
    private async processBatch(events: AuditEvent[]): Promise<void> {
        const promises = events.map(async (event) => {
            try {
                // Store event
                await this.storeAuditEvent(event);
                
                // Add to cache
                this.auditEvents.set(event.eventId, event);
                
                // Clean up cache if needed
                if (this.auditEvents.size > this.MAX_CACHE_SIZE) {
                    this.cleanupEventCache();
                }
                
            } catch (error) {
                loggingService.error('Failed to process audit event', {
                    component: 'ComprehensiveAuditService',
                    eventId: event.eventId,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        });

        await Promise.allSettled(promises);
    }

    /**
     * Process event immediately (for critical events)
     */
    private async processEventImmediate(event: AuditEvent): Promise<void> {
        try {
            await this.storeAuditEvent(event);
            this.auditEvents.set(event.eventId, event);

            // Send immediate alerts for critical events
            if (event.severity === 'critical') {
                await this.sendCriticalEventAlert(event);
            }

        } catch (error) {
            loggingService.error('Failed to process critical event immediately', {
                component: 'ComprehensiveAuditService',
                eventId: event.eventId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    // Helper methods and utilities
    private determineSeverity(eventType: AuditEventType, riskLevel: string): AuditSeverity {
        if (riskLevel === 'critical') return 'critical';
        if (riskLevel === 'high') return 'high';
        
        const severityMap: Record<AuditEventType, AuditSeverity> = {
            data_transmission: 'high',
            data_deletion: 'high',
            permission_change: 'medium',
            security_event: 'high',
            user_authentication: 'medium',
            ai_processing: 'medium',
            system_configuration: 'medium',
            data_access: 'low',
            data_modification: 'medium',
            user_authorization: 'low',
            api_call: 'info',
            file_upload: 'low',
            report_generation: 'info',
            backup_creation: 'info',
            backup_restoration: 'medium',
            system_maintenance: 'info',
            compliance_check: 'medium'
        };

        return severityMap[eventType] || 'info';
    }

    private categorizeEvent(eventType: AuditEventType): string {
        const categories: Record<AuditEventType, string> = {
            data_access: 'data_operations',
            data_modification: 'data_operations',
            data_deletion: 'data_operations',
            data_transmission: 'data_operations',
            user_authentication: 'access_control',
            user_authorization: 'access_control',
            permission_change: 'access_control',
            system_configuration: 'system_administration',
            security_event: 'security',
            compliance_check: 'compliance',
            ai_processing: 'ai_operations',
            api_call: 'api_operations',
            file_upload: 'file_operations',
            report_generation: 'reporting',
            backup_creation: 'backup_operations',
            backup_restoration: 'backup_operations',
            system_maintenance: 'system_administration'
        };

        return categories[eventType] || 'general';
    }

    private subcategorizeEvent(eventType: AuditEventType, action: string): string {
        return `${eventType}_${action.toLowerCase().replace(/\s+/g, '_')}`;
    }

    private getSeverityIndex(severity: AuditSeverity): number {
        const severities = ['info', 'low', 'medium', 'high', 'critical'];
        return severities.indexOf(severity);
    }

    private getRiskLevelIndex(riskLevel: string): number {
        const levels = ['low', 'medium', 'high', 'critical'];
        return levels.indexOf(riskLevel);
    }

    private aggregateByField<T>(items: T[], fieldFn: (item: T) => string): Record<string, number> {
        return items.reduce((acc, item) => {
            const key = fieldFn(item);
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
    }

    // Storage methods
    private async storeAuditEvent(event: AuditEvent): Promise<void> {
        try {
            const cacheKey = `audit_event:${event.eventId}`;
            const ttl = this.config.retentionPeriod * 86400; // Convert days to seconds
            await cacheService.set(cacheKey, event, ttl);
        } catch (error) {
            throw new Error(`Failed to store audit event: ${error}`);
        }
    }

    private async storeDataLineage(dataId: string, lineage: DataLineageInfo): Promise<void> {
        try {
            const cacheKey = `data_lineage:${dataId}`;
            await cacheService.set(cacheKey, lineage, 86400 * 365); // 1 year
        } catch (error) {
            loggingService.error('Failed to store data lineage', {
                component: 'ComprehensiveAuditService',
                dataId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    private async storeAuditReport(report: AuditReport): Promise<void> {
        try {
            const cacheKey = `audit_report:${report.reportId}`;
            await cacheService.set(cacheKey, report, 86400 * 365); // 1 year
        } catch (error) {
            loggingService.error('Failed to store audit report', {
                component: 'ComprehensiveAuditService',
                reportId: report.reportId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    // Utility methods
    private generateEventId(): string {
        return `evt_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    }

    private generateRequestId(): string {
        return `req_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    }

    private generateCorrelationId(): string {
        return `cor_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    }

    private generateReportId(): string {
        return `rpt_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    }

    private generateDataHash(data: string): string {
        return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
    }

    private cleanupEventCache(): void {
        if (this.auditEvents.size <= this.MAX_CACHE_SIZE) return;
        
        const events = Array.from(this.auditEvents.entries());
        events.sort((a, b) => a[1].timestamp - b[1].timestamp);
        
        // Remove oldest 20%
        const toRemove = Math.floor(this.MAX_CACHE_SIZE * 0.2);
        for (let i = 0; i < toRemove; i++) {
            this.auditEvents.delete(events[i][0]);
        }
    }

    private async getRecentEvents(actorKey: string, timeWindow: number): Promise<AuditEvent[]> {
        const now = Date.now();
        return Array.from(this.auditEvents.values())
            .filter(e => `${e.actor.type}:${e.actor.id}` === actorKey && (now - e.timestamp) < timeWindow);
    }

    private async updateAnomalyBaselines(): Promise<void> {
        // Update baseline activity levels for anomaly detection
        const now = Date.now();
        const oneHour = 3600000;
        
        for (const event of this.auditEvents.values()) {
            if ((now - event.timestamp) > oneHour) continue;
            
            const key = `${event.actor.type}:${event.actor.id}:${event.eventType}`;
            const current = this.anomalyBaselines.get(key) || 0;
            this.anomalyBaselines.set(key, current + 1);
        }
    }

    private async sendCriticalEventAlert(event: AuditEvent): Promise<void> {
        loggingService.error('CRITICAL AUDIT EVENT ALERT', {
            component: 'ComprehensiveAuditService',
            eventId: event.eventId,
            eventType: event.eventType,
            severity: event.severity,
            riskLevel: event.security.riskLevel,
            actor: event.actor.id,
            target: event.target.id,
            threatIndicators: event.security.threatIndicators
        });
    }

    private async analyzeAuditFindings(reportType: string, events: AuditEvent[], parameters: any): Promise<any> {
        // Simplified findings analysis - would be more sophisticated in practice
        return {
            securityFindings: [],
            complianceFindings: [],
            anomalies: events.filter(e => e.security.anomalyScore > 0.6).map(e => ({
                type: 'behavioral_anomaly',
                description: `Unusual ${e.eventType} activity by ${e.actor.id}`,
                events: [e.eventId],
                score: e.security.anomalyScore,
                investigation: 'Review user activity patterns'
            })),
            dataLineage: Array.from(this.dataLineageMap.values()).map(lineage => ({
                dataId: lineage.sourceId,
                source: lineage.sourceName,
                transformations: lineage.transformations.length,
                destinations: lineage.destinations.map(d => d.destinationType),
                retentionStatus: lineage.retentionPolicy.autoDelete ? 'managed' : 'manual'
            }))
        };
    }

    private generateAuditRecommendations(reportType: string, findings: any, summary: any): AuditReport['recommendations'] {
        const recommendations = {
            immediate: [] as string[],
            shortTerm: [] as string[],
            longTerm: [] as string[],
            compliance: [] as string[],
            security: [] as string[]
        };

        if (summary.anomalousEvents > summary.totalEvents * 0.05) {
            recommendations.security.push('Investigate high anomaly rate in user behavior');
        }

        if (summary.failedEvents > summary.totalEvents * 0.1) {
            recommendations.immediate.push('Address high failure rate in system operations');
        }

        if (findings.dataLineage.length > 0) {
            recommendations.compliance.push('Review data lineage for retention compliance');
        }

        return recommendations;
    }

    private updateStatistics(event: AuditEvent, processingTime: number): void {
        this.stats.totalEvents++;
        
        if (event.eventType === 'security_event') this.stats.securityEvents++;
        if (event.eventType === 'compliance_check') this.stats.complianceEvents++;
        if (event.security.anomalyScore > 0.6) this.stats.anomalousEvents++;
        if (event.context.dataLineage) this.stats.dataLineageEvents++;

        // Update average processing time
        const totalTime = (this.stats.averageProcessingTime * (this.stats.totalEvents - 1)) + processingTime;
        this.stats.averageProcessingTime = totalTime / this.stats.totalEvents;

        // Update average event size
        const eventSize = JSON.stringify(event).length;
        const totalSize = (this.stats.averageEventSize * (this.stats.totalEvents - 1)) + eventSize;
        this.stats.averageEventSize = totalSize / this.stats.totalEvents;
    }

    /**
     * Get service statistics
     */
    public getStatistics(): typeof this.stats & { 
        cacheSize: number; 
        bufferSize: number; 
        lineageTracked: number; 
    } {
        return {
            ...this.stats,
            cacheSize: this.auditEvents.size,
            bufferSize: this.eventBuffer.length,
            lineageTracked: this.dataLineageMap.size
        };
    }

    /**
     * Cleanup resources
     */
    public cleanup(): void {
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
            this.flushInterval = undefined;
        }
        
        if (this.anomalyDetectionInterval) {
            clearInterval(this.anomalyDetectionInterval);
            this.anomalyDetectionInterval = undefined;
        }
        
        this.auditEvents.clear();
        this.eventBuffer = [];
        this.dataLineageMap.clear();
        this.anomalyBaselines.clear();
        this.removeAllListeners();
    }
}

// Export singleton instance
export const comprehensiveAuditService = ComprehensiveAuditService.getInstance();
