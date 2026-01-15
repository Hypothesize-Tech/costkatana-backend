import { Request, Response } from 'express';
import { loggingService } from '../services/logging.service';
import { aiProviderAuditService } from '../services/aiProviderAudit.service';
import { preTransmissionFilterService } from '../services/preTransmissionFilter.service';
import { dataClassificationService } from '../services/dataClassification.service';
import { complianceEnforcementService } from '../services/complianceEnforcement.service';
import { comprehensiveAuditService } from '../services/comprehensiveAudit.service';
import { realTimeSecurityMonitoringService } from '../services/realTimeSecurityMonitoring.service';

/**
 * Enterprise Security Controller
 * Provides endpoints for security monitoring, compliance reporting, and audit management
 */

export class EnterpriseSecurityController {

    /**
     * Get comprehensive security dashboard
     */
    static async getSecurityDashboard(req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
        
        try {
            loggingService.info('Security dashboard request initiated', {
                component: 'EnterpriseSecurityController',
                userId: (req as any).user?.id,
                requestId: req.headers['x-request-id'] as string
            });

            // Get real-time monitoring dashboard
            const dashboard = await realTimeSecurityMonitoringService.getMonitoringDashboard();
            
            // Get additional security statistics
            const securityStats = {
                audit: comprehensiveAuditService.getStatistics(),
                compliance: complianceEnforcementService.getStatistics(),
                ai_audit: aiProviderAuditService.getStatistics(),
                filtering: preTransmissionFilterService.getStatistics(),
                classification: dataClassificationService.getStatistics(),
                monitoring: realTimeSecurityMonitoringService.getStatistics()
            };

            const duration = Date.now() - startTime;

            loggingService.info('Security dashboard generated successfully', {
                component: 'EnterpriseSecurityController',
                duration,
                alertCount: dashboard.realtime.active_alerts.length,
                threatLevel: dashboard.threat_landscape.current_threat_level,
                complianceScore: dashboard.compliance_status.overall_score
            });

            res.json({
                success: true,
                data: {
                    dashboard,
                    statistics: securityStats,
                    generated_at: Date.now(),
                    performance: {
                        generation_time: duration,
                        cache_status: 'live'
                    }
                }
            });

        } catch (error) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Security dashboard generation failed', {
                component: 'EnterpriseSecurityController',
                error: error instanceof Error ? error.message : String(error),
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to generate security dashboard',
                message: 'Internal security monitoring error'
            });
        }
    }

    /**
     * Get compliance report for specific framework
     */
    static async getComplianceReport(req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
        const framework = Array.isArray(req.query.framework) ? req.query.framework[0] : req.query.framework as string;
        const start_date = Array.isArray(req.query.start_date) ? req.query.start_date[0] : req.query.start_date as string;
        const end_date = Array.isArray(req.query.end_date) ? req.query.end_date[0] : req.query.end_date as string;
        
        try {
            if (!framework) {
                res.status(400).json({
                    success: false,
                    error: 'Missing required parameter: framework',
                    message: 'Please specify compliance framework (gdpr, hipaa, soc2, etc.)'
                });
                return;
            }

            const timeRange = {
                start: start_date ? parseInt(start_date as string) : Date.now() - (30 * 24 * 60 * 60 * 1000), // Default 30 days
                end: end_date ? parseInt(end_date as string) : Date.now()
            };

            loggingService.info('Compliance report request initiated', {
                component: 'EnterpriseSecurityController',
                framework,
                timeRange,
                userId: (req as any).user?.id
            });

            // Generate compliance report
            const report = await complianceEnforcementService.generateComplianceReport(
                framework as any,
                timeRange
            );

            const duration = Date.now() - startTime;

            loggingService.info('Compliance report generated successfully', {
                component: 'EnterpriseSecurityController',
                framework,
                duration,
                violations: report.summary.violations,
                criticalViolations: report.summary.criticalViolations
            });

            res.json({
                success: true,
                data: {
                    report,
                    generated_at: Date.now(),
                    performance: {
                        generation_time: duration
                    }
                }
            });

        } catch (error) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Compliance report generation failed', {
                component: 'EnterpriseSecurityController',
                framework,
                error: error instanceof Error ? error.message : String(error),
                duration
            });

            res.status(500).json({
                success: false,
                error: 'Failed to generate compliance report',
                message: error instanceof Error ? error.message : 'Internal compliance system error'
            });
        }
    }

    /**
     * Query audit events
     */
    static async queryAuditEvents(req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
        
        try {
            const eventTypesParam = req.query.event_types as string;
            const severityParam = req.query.severity as string;
            const actorIdsParam = req.query.actor_ids as string;
            const riskLevelParam = req.query.risk_level as string;
            
            const query = {
                eventTypes: eventTypesParam ? [eventTypesParam] as any[] : undefined,
                severity: severityParam ? [severityParam] as any[] : undefined,
                actorIds: actorIdsParam ? [actorIdsParam] : undefined,
                timeRange: req.query.start_date && req.query.end_date ? {
                    start: parseInt(req.query.start_date as string),
                    end: parseInt(req.query.end_date as string)
                } : undefined,
                riskLevel: riskLevelParam ? [riskLevelParam] : undefined,
                searchText: req.query.search as string,
                limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
                offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
                sortBy: (req.query.sort_by as any) || 'timestamp',
                sortOrder: (req.query.sort_order as any) || 'desc'
            };

            loggingService.info('Audit events query initiated', {
                component: 'EnterpriseSecurityController',
                query,
                userId: (req as any).user?.id
            });

            const results = await comprehensiveAuditService.queryEvents(query);
            const duration = Date.now() - startTime;

            loggingService.info('Audit events query completed', {
                component: 'EnterpriseSecurityController',
                duration,
                eventsFound: results.total,
                eventsReturned: results.events.length
            });

            res.json({
                success: true,
                data: {
                    events: results.events,
                    pagination: {
                        total: results.total,
                        limit: query.limit,
                        offset: query.offset,
                        has_more: results.hasMore
                    },
                    aggregations: results.aggregations,
                    performance: {
                        query_time: duration
                    }
                }
            });

        } catch (error) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Audit events query failed', {
                component: 'EnterpriseSecurityController',
                error: error instanceof Error ? error.message : String(error),
                duration
            });

            res.status(500).json({
                success: false,
                error: 'Failed to query audit events',
                message: error instanceof Error ? error.message : 'Internal audit system error'
            });
        }
    }

    /**
     * Test content filtering
     */
    static async testContentFiltering(req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
        const { content, provider = 'test', model = 'test' } = req.body;
        
        try {
            if (!content) {
                res.status(400).json({
                    success: false,
                    error: 'Missing required parameter: content',
                    message: 'Please provide content to test filtering'
                });
                return;
            }

            loggingService.info('Content filtering test initiated', {
                component: 'EnterpriseSecurityController',
                contentLength: content.length,
                provider,
                model,
                userId: (req as any).user?.id
            });

            // Test pre-transmission filtering
            const filterResult = await preTransmissionFilterService.filterContent(content, {
                userId: (req as any).user?.id || 'test_user',
                provider,
                model,
                endpoint: req.path,
                userTier: (req as any).user?.tier || 'standard'
            });

            // Test data classification
            const classification = await dataClassificationService.classifyContent(content, {
                userId: (req as any).user?.id || 'test_user',
                sessionId: 'test_session',
                source: 'test_api',
                destination: provider,
                purpose: 'content_testing',
                userTier: (req as any).user?.tier || 'standard',
                ipAddress: req.ip || 'unknown',
                userAgent: req.headers['user-agent'] || 'unknown'
            });

            // Test compliance checking
            const complianceCheck = await complianceEnforcementService.performComplianceCheck(content, {
                userId: (req as any).user?.id || 'test_user',
                userLocation: req.headers['x-forwarded-for'] as string || 'unknown',
                processingPurpose: 'content_testing',
                dataSource: 'test_api',
                destination: provider,
                userTier: (req as any).user?.tier || 'standard'
            });

            const duration = Date.now() - startTime;

            loggingService.info('Content filtering test completed', {
                component: 'EnterpriseSecurityController',
                duration,
                filterAllowed: filterResult.allowed,
                classificationLevel: classification.classification.level,
                complianceStatus: complianceCheck.compliant
            });

            res.json({
                success: true,
                data: {
                    filtering: {
                        allowed: filterResult.allowed,
                        modified: filterResult.modified,
                        risk_score: filterResult.riskScore,
                        detections: filterResult.detections.length,
                        blocked_reason: filterResult.blockedReason
                    },
                    classification: {
                        level: classification.classification.level,
                        categories: classification.classification.categories,
                        confidence: classification.classification.confidenceScore,
                        risk_score: classification.classification.riskScore,
                        compliance_frameworks: classification.classification.complianceFrameworks
                    },
                    compliance: {
                        compliant: complianceCheck.compliant,
                        violations: complianceCheck.violations.length,
                        allowed_with_conditions: complianceCheck.allowedWithConditions,
                        required_actions: complianceCheck.requiredActions
                    },
                    overall: {
                        security_approved: filterResult.allowed && complianceCheck.compliant,
                        risk_level: Math.max(filterResult.riskScore, classification.classification.riskScore),
                        processing_time: duration
                    }
                }
            });

        } catch (error) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Content filtering test failed', {
                component: 'EnterpriseSecurityController',
                error: error instanceof Error ? error.message : String(error),
                duration
            });

            res.status(500).json({
                success: false,
                error: 'Content filtering test failed',
                message: error instanceof Error ? error.message : 'Internal security system error'
            });
        }
    }

    /**
     * Get security alerts
     */
    static async getSecurityAlerts(req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
        const severity = Array.isArray(req.query.severity) ? req.query.severity[0] : req.query.severity as string;
        const category = Array.isArray(req.query.category) ? req.query.category[0] : req.query.category as string;
        const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
        const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
        
        try {
            loggingService.info('Security alerts request initiated', {
                component: 'EnterpriseSecurityController',
                severity,
                category,
                limit,
                offset
            });

            // Get alerts from various services
            const [
                filterAlerts,
                auditAlerts,
                complianceAlerts
            ] = await Promise.all([
                preTransmissionFilterService.getRecentAlerts(limit),
                comprehensiveAuditService.queryEvents({
                    eventTypes: ['security_event'] as any,
                    severity: severity ? [severity] as any : undefined,
                    limit: limit,
                    offset: offset,
                    timeRange: {
                        start: Date.now() - (24 * 60 * 60 * 1000), // Last 24 hours
                        end: Date.now()
                    }
                }),
                // Get compliance violations as alerts
                this.getComplianceAlerts(limit)
            ]);

            // Combine and sort alerts
            const allAlerts = [
                ...filterAlerts.map(alert => ({
                    ...alert,
                    source: 'pre_transmission_filter',
                    type: 'filter_alert'
                })),
                ...auditAlerts.events.map(event => ({
                    id: event.eventId,
                    timestamp: event.timestamp,
                    severity: event.severity,
                    category: 'audit',
                    type: 'audit_event',
                    message: event.event.description,
                    source: 'comprehensive_audit',
                    details: {
                        event_type: event.eventType,
                        actor: event.actor.id,
                        target: event.target.id,
                        risk_level: event.security.riskLevel
                    }
                })),
                ...complianceAlerts.map(alert => ({
                    ...alert,
                    source: 'compliance_enforcement',
                    type: 'compliance_alert'
                }))
            ];

            // Apply filters
            let filteredAlerts = allAlerts;
            
            if (severity) {
                const severityFilter = [severity];
                filteredAlerts = filteredAlerts.filter(alert => 
                    severityFilter.includes(alert.severity)
                );
            }
            
            if (category) {
                const categoryFilter = [category];
                filteredAlerts = filteredAlerts.filter(alert => 
                    categoryFilter.includes(alert.category)
                );
            }

            // Sort by timestamp (newest first)
            filteredAlerts.sort((a, b) => b.timestamp - a.timestamp);

            // Apply pagination
            const paginatedAlerts = filteredAlerts.slice(
                offset,
                offset + limit
            );

            const duration = Date.now() - startTime;

            loggingService.info('Security alerts retrieved successfully', {
                component: 'EnterpriseSecurityController',
                duration,
                totalAlerts: filteredAlerts.length,
                returnedAlerts: paginatedAlerts.length
            });

            res.json({
                success: true,
                data: {
                    alerts: paginatedAlerts,
                    pagination: {
                        total: filteredAlerts.length,
                        limit: limit,
                        offset: offset,
                        has_more: offset + limit < filteredAlerts.length
                    },
                    summary: {
                        by_severity: this.groupBy(filteredAlerts, 'severity'),
                        by_category: this.groupBy(filteredAlerts, 'category'),
                        by_source: this.groupBy(filteredAlerts, 'source')
                    },
                    performance: {
                        query_time: duration
                    }
                }
            });

        } catch (error) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Security alerts retrieval failed', {
                component: 'EnterpriseSecurityController',
                error: error instanceof Error ? error.message : String(error),
                duration
            });

            res.status(500).json({
                success: false,
                error: 'Failed to retrieve security alerts',
                message: error instanceof Error ? error.message : 'Internal security system error'
            });
        }
    }

    /**
     * Get data lineage for specific data item
     */
    static async getDataLineage(req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
        const { dataId } = req.params;
        
        try {
            if (!dataId) {
                res.status(400).json({
                    success: false,
                    error: 'Missing required parameter: dataId',
                    message: 'Please specify data ID for lineage tracking'
                });
                return;
            }

            loggingService.info('Data lineage request initiated', {
                component: 'EnterpriseSecurityController',
                dataId,
                userId: (req as any).user?.id
            });

            // Get data lineage from audit service
            const lineage = comprehensiveAuditService.getDataLineage(dataId);
            
            if (!lineage) {
                res.status(404).json({
                    success: false,
                    error: 'Data lineage not found',
                    message: `No lineage data available for ID: ${dataId}`
                });
                return;
            }

            // Get related audit events
            const relatedEvents = await comprehensiveAuditService.queryEvents({
                targetIds: [dataId],
                limit: 100,
                sortBy: 'timestamp',
                sortOrder: 'desc'
            });

            const duration = Date.now() - startTime;

            loggingService.info('Data lineage retrieved successfully', {
                component: 'EnterpriseSecurityController',
                dataId,
                duration,
                transformations: lineage.transformations.length,
                destinations: lineage.destinations.length
            });

            res.json({
                success: true,
                data: {
                    lineage,
                    related_events: relatedEvents.events,
                    summary: {
                        transformations: lineage.transformations.length,
                        destinations: lineage.destinations.length,
                        retention_status: lineage.retentionPolicy.autoDelete ? 'managed' : 'manual',
                        delete_after: new Date(lineage.retentionPolicy.deleteAfter).toISOString()
                    },
                    performance: {
                        query_time: duration
                    }
                }
            });

        } catch (error) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Data lineage retrieval failed', {
                component: 'EnterpriseSecurityController',
                dataId,
                error: error instanceof Error ? error.message : String(error),
                duration
            });

            res.status(500).json({
                success: false,
                error: 'Failed to retrieve data lineage',
                message: error instanceof Error ? error.message : 'Internal audit system error'
            });
        }
    }

    /**
     * Generate comprehensive audit report
     */
    static async generateAuditReport(req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
        const { 
            report_type = 'security_review',
            start_date,
            end_date,
            include_evidence = false,
            include_recommendations = true,
            scope = []
        } = req.body;
        
        try {
            const timeRange = {
                start: start_date ? parseInt(start_date) : Date.now() - (30 * 24 * 60 * 60 * 1000),
                end: end_date ? parseInt(end_date) : Date.now()
            };

            const parameters = {
                timeRange,
                scope: Array.isArray(scope) ? scope : [scope].filter(Boolean),
                frameworks: ['gdpr', 'hipaa', 'soc2', 'pci_dss'],
                includeEvidence: Boolean(include_evidence),
                includeRecommendations: Boolean(include_recommendations)
            };

            loggingService.info('Audit report generation initiated', {
                component: 'EnterpriseSecurityController',
                reportType: report_type,
                parameters,
                userId: (req as any).user?.id
            });

            // Generate comprehensive audit report
            const report = await comprehensiveAuditService.generateAuditReport(
                report_type,
                parameters,
                (req as any).user?.id || 'system'
            );

            const duration = Date.now() - startTime;

            loggingService.info('Audit report generated successfully', {
                component: 'EnterpriseSecurityController',
                reportId: report.reportId,
                duration,
                totalEvents: report.summary.totalEvents,
                securityEvents: report.summary.securityEvents
            });

            res.json({
                success: true,
                data: {
                    report,
                    performance: {
                        generation_time: duration,
                        events_processed: report.summary.totalEvents
                    }
                }
            });

        } catch (error) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Audit report generation failed', {
                component: 'EnterpriseSecurityController',
                reportType: report_type,
                error: error instanceof Error ? error.message : String(error),
                duration
            });

            res.status(500).json({
                success: false,
                error: 'Failed to generate audit report',
                message: error instanceof Error ? error.message : 'Internal audit system error'
            });
        }
    }

    /**
     * Get AI provider audit records
     */
    static async getAIProviderAuditRecords(req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
        
        try {
            const query = {
                userId: req.query.user_id as string,
                provider: req.query.provider as string,
                timeRange: req.query.start_date && req.query.end_date ? {
                    start: parseInt(req.query.start_date as string),
                    end: parseInt(req.query.end_date as string)
                } : undefined,
                riskLevel: req.query.risk_level ? [req.query.risk_level as string] : undefined,
                limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
                offset: req.query.offset ? parseInt(req.query.offset as string) : 0
            };

            loggingService.info('AI provider audit records request initiated', {
                component: 'EnterpriseSecurityController',
                query,
                requestingUser: (req as any).user?.id
            });

            const results = await aiProviderAuditService.queryAuditRecords(query);
            const duration = Date.now() - startTime;

            loggingService.info('AI provider audit records retrieved', {
                component: 'EnterpriseSecurityController',
                duration,
                recordsFound: results.total,
                recordsReturned: results.records.length
            });

            res.json({
                success: true,
                data: {
                    records: results.records.map(record => ({
                        request_id: record.requestId,
                        timestamp: record.timestamp,
                        provider: record.provider,
                        model: record.model,
                        user_id: record.userId,
                        risk_level: record.security.riskLevel,
                        pii_detected: record.security.piiDetected,
                        transmission_status: record.transmission.status,
                        compliance_frameworks: record.compliance.gdprApplicable ? ['gdpr'] : []
                    })),
                    pagination: {
                        total: results.total,
                        limit: query.limit,
                        offset: query.offset,
                        has_more: results.hasMore
                    },
                    performance: {
                        query_time: duration
                    }
                }
            });

        } catch (error) {
            const duration = Date.now() - startTime;
            
            loggingService.error('AI provider audit records retrieval failed', {
                component: 'EnterpriseSecurityController',
                error: error instanceof Error ? error.message : String(error),
                duration
            });

            res.status(500).json({
                success: false,
                error: 'Failed to retrieve AI provider audit records',
                message: error instanceof Error ? error.message : 'Internal audit system error'
            });
        }
    }

    /**
     * Get comprehensive security statistics
     */
    static async getSecurityStatistics(req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
        
        try {
            loggingService.info('Security statistics request initiated', {
                component: 'EnterpriseSecurityController',
                userId: (req as any).user?.id
            });

            // Gather statistics from all security services
            const statistics = {
                ai_provider_audit: aiProviderAuditService.getStatistics(),
                pre_transmission_filter: preTransmissionFilterService.getStatistics(),
                data_classification: dataClassificationService.getStatistics(),
                compliance_enforcement: complianceEnforcementService.getStatistics(),
                comprehensive_audit: comprehensiveAuditService.getStatistics(),
                real_time_monitoring: realTimeSecurityMonitoringService.getStatistics()
            };

            // Calculate overall security score
            const securityScore = this.calculateOverallSecurityScore(statistics);

            const duration = Date.now() - startTime;

            loggingService.info('Security statistics retrieved successfully', {
                component: 'EnterpriseSecurityController',
                duration,
                securityScore
            });

            res.json({
                success: true,
                data: {
                    statistics,
                    overall: {
                        security_score: securityScore,
                        status: securityScore > 90 ? 'excellent' :
                               securityScore > 75 ? 'good' :
                               securityScore > 60 ? 'fair' : 'needs_improvement'
                    },
                    performance: {
                        query_time: duration
                    }
                }
            });

        } catch (error) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Security statistics retrieval failed', {
                component: 'EnterpriseSecurityController',
                error: error instanceof Error ? error.message : String(error),
                duration
            });

            res.status(500).json({
                success: false,
                error: 'Failed to retrieve security statistics',
                message: error instanceof Error ? error.message : 'Internal security system error'
            });
        }
    }

    // Helper methods
    private static async getComplianceAlerts(_limit: number): Promise<any[]> {
        try {
            // This would get actual compliance alerts
            // For now, return empty array as compliance alerts are handled via events
            return [];
        } catch {
            return [];
        }
    }

    private static groupBy(array: any[], key: string): Record<string, number> {
        return array.reduce((acc, item) => {
            const value = item[key] || 'unknown';
            acc[value] = (acc[value] || 0) + 1;
            return acc;
        }, {});
    }

    private static calculateOverallSecurityScore(statistics: any): number {
        try {
            // Calculate weighted security score based on various metrics
            let score = 100;
            
            // Deduct points for violations and issues
            const auditStats = statistics.comprehensive_audit;
            const complianceStats = statistics.compliance_enforcement;
            const filterStats = statistics.pre_transmission_filter;
            const aiAuditStats = statistics.ai_provider_audit;
            
            // Audit score impact (20% weight)
            if (auditStats.totalEvents > 0) {
                const anomalyRate = auditStats.anomalousEvents / auditStats.totalEvents;
                score -= anomalyRate * 20;
            }
            
            // Compliance score impact (30% weight)
            if (complianceStats.totalChecks > 0) {
                const violationRate = complianceStats.violationsDetected / complianceStats.totalChecks;
                score -= violationRate * 30;
                
                const criticalViolationRate = complianceStats.criticalViolations / complianceStats.totalChecks;
                score -= criticalViolationRate * 20; // Additional penalty for critical violations
            }
            
            // Filter effectiveness (25% weight)
            if (filterStats.totalRequests > 0) {
                const blockRate = filterStats.blockedRequests / filterStats.totalRequests;
                if (blockRate > 0.1) { // High block rate indicates security issues
                    score -= (blockRate - 0.1) * 25;
                }
            }
            
            // AI audit score (25% weight)
            if (aiAuditStats.totalRequests > 0) {
                const aiBlockRate = aiAuditStats.blockedRequests / aiAuditStats.totalRequests;
                if (aiBlockRate > 0.05) { // High AI block rate indicates issues
                    score -= (aiBlockRate - 0.05) * 25;
                }
            }
            
            return Math.max(0, Math.min(100, score));
        } catch {
            return 50; // Default middle score on error
        }
    }
}
