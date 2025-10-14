import { Response, NextFunction } from 'express';
import { loggingService } from '../services/logging.service';
import { aiProviderAuditService } from '../services/aiProviderAudit.service';
import { preTransmissionFilterService } from '../services/preTransmissionFilter.service';
import { dataClassificationService } from '../services/dataClassification.service';
import { complianceEnforcementService } from '../services/complianceEnforcement.service';
import { comprehensiveAuditService } from '../services/comprehensiveAudit.service';
import { realTimeSecurityMonitoringService } from '../services/realTimeSecurityMonitoring.service';

/**
 * Enterprise Security Middleware
 * Integrates all security systems for comprehensive protection
 */

export interface SecurityMiddlewareOptions {
    enableAIProviderAudit?: boolean;
    enablePreTransmissionFilter?: boolean;
    enableDataClassification?: boolean;
    enableComplianceChecking?: boolean;
    enableComprehensiveAudit?: boolean;
    enableRealTimeMonitoring?: boolean;
    
    // Security levels
    securityLevel?: 'standard' | 'high' | 'maximum';
    complianceMode?: 'permissive' | 'strict' | 'maximum';
    
    // Bypass options
    bypassAllSecurity?: boolean;
    bypassSpecificChecks?: string[];
    
    // AI processing specific
    isAIProcessing?: boolean;
    aiProvider?: string;
    aiModel?: string;
    
    // Custom handlers
    customSecurityHandler?: (req: any, res: Response, violations: any[]) => Promise<boolean>;
    customComplianceHandler?: (req: any, res: Response, violations: any[]) => Promise<boolean>;
    customAuditHandler?: (req: any, res: Response, eventType: string) => Promise<void>;
    
    // Monitoring
    enableDetailedLogging?: boolean;
    enablePerformanceTracking?: boolean;
}

/**
 * Main enterprise security middleware
 */
export function enterpriseSecurityMiddleware(
    options: SecurityMiddlewareOptions = {}
): (req: any, res: Response, next: NextFunction) => void {
    const {
        enableAIProviderAudit = true,
        enablePreTransmissionFilter = true,
        enableDataClassification = true,
        enableComplianceChecking = true,
        enableComprehensiveAudit = true,
        enableRealTimeMonitoring = true,
        
        securityLevel = 'high',
        complianceMode = 'strict',
        
        bypassAllSecurity = false,
        bypassSpecificChecks = [],
        
        isAIProcessing = false,
        aiProvider = 'unknown',
        aiModel = 'unknown',
        
        customSecurityHandler,
        customComplianceHandler,
        customAuditHandler,
        
        enableDetailedLogging = false,
        enablePerformanceTracking = true
    } = options;

    return async (req: any, res: Response, next: NextFunction): Promise<void> => {
        const startTime = Date.now();
        const requestId = req.requestId || req.headers['x-request-id'] || generateRequestId();
        
        // Set security context
        req.securityContext = {
            requestId,
            securityLevel,
            complianceMode,
            isAIProcessing,
            timestamp: startTime
        };

        if (enableDetailedLogging) {
            loggingService.info('=== ENTERPRISE SECURITY MIDDLEWARE STARTED ===', {
                component: 'EnterpriseSecurityMiddleware',
                requestId,
                path: req.path,
                method: req.method,
                securityLevel,
                isAIProcessing
            });
        }

        try {
            // Skip all security checks if bypassed or emergency endpoint
            if (bypassAllSecurity || isEmergencyEndpoint(req.path)) {
                if (enableDetailedLogging) {
                    loggingService.info('Bypassing all security checks', {
                        component: 'EnterpriseSecurityMiddleware',
                        requestId,
                        reason: bypassAllSecurity ? 'bypass_flag' : 'emergency_endpoint'
                    });
                }
                next();
                return;
            }

            const violations: any[] = [];
            const securityEvents: string[] = [];
            let blocked = false;
            let blockReason = '';

            // Extract content for analysis
            const content = extractContentFromRequest(req);
            const context = extractContextFromRequest(req);

            // 1. Data Classification
            if (enableDataClassification && !bypassSpecificChecks.includes('data_classification')) {
                try {
                    const classification = await dataClassificationService.classifyContent(content, context);
                    req.dataClassification = classification;
                    
                    // Add classification headers
                    res.setHeader('X-Data-Classification', classification.classification.level);
                    res.setHeader('X-Data-Categories', classification.classification.categories.join(','));
                    res.setHeader('X-Compliance-Frameworks', classification.classification.complianceFrameworks.join(','));
                    
                    securityEvents.push('data_classified');
                    
                    if (enableDetailedLogging) {
                        loggingService.info('Content classified', {
                            component: 'EnterpriseSecurityMiddleware',
                            requestId,
                            level: classification.classification.level,
                            riskScore: classification.classification.riskScore
                        });
                    }
                } catch (error) {
                    loggingService.error('Data classification failed', {
                        component: 'EnterpriseSecurityMiddleware',
                        requestId,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }

            // 2. Pre-Transmission Filtering
            if (enablePreTransmissionFilter && !bypassSpecificChecks.includes('pre_transmission_filter') && content) {
                try {
                    const filterResult = await preTransmissionFilterService.filterContent(content, {
                        userId: req.user?.id || 'anonymous',
                        provider: aiProvider,
                        model: aiModel,
                        endpoint: req.path,
                        userTier: req.user?.tier || 'free'
                    });
                    
                    req.filterResult = filterResult;
                    
                    // Add filter headers
                    res.setHeader('X-Content-Filtered', filterResult.modified.toString());
                    res.setHeader('X-Filter-Risk-Score', filterResult.riskScore.toFixed(3));
                    res.setHeader('X-Filter-Detections', filterResult.detections.length.toString());
                    
                    if (!filterResult.allowed) {
                        blocked = true;
                        blockReason = filterResult.blockedReason || 'Content blocked by security filter';
                        violations.push({
                            type: 'content_filter_violation',
                            severity: 'high',
                            details: filterResult
                        });
                    }
                    
                    securityEvents.push('content_filtered');
                    
                    if (enableDetailedLogging) {
                        loggingService.info('Content filtered', {
                            component: 'EnterpriseSecurityMiddleware',
                            requestId,
                            allowed: filterResult.allowed,
                            modified: filterResult.modified,
                            riskScore: filterResult.riskScore
                        });
                    }
                } catch (error) {
                    loggingService.error('Pre-transmission filtering failed', {
                        component: 'EnterpriseSecurityMiddleware',
                        requestId,
                        error: error instanceof Error ? error.message : String(error)
                    });
                    
                    // Fail safe - block on error for high security levels
                    if (securityLevel === 'maximum') {
                        blocked = true;
                        blockReason = 'Security filter system error';
                    }
                }
            }

            // 3. Compliance Checking
            if (enableComplianceChecking && !bypassSpecificChecks.includes('compliance_checking')) {
                try {
                    const complianceCheck = await complianceEnforcementService.performComplianceCheck(content, {
                        userId: req.user?.id || 'anonymous',
                        userLocation: req.headers['x-forwarded-for'] || 'unknown',
                        processingPurpose: isAIProcessing ? 'ai_processing' : 'api_processing',
                        dataSource: req.path,
                        destination: isAIProcessing ? aiProvider : 'internal',
                        userTier: req.user?.tier || 'free'
                    });
                    
                    req.complianceCheck = complianceCheck;
                    
                    // Add compliance headers
                    res.setHeader('X-Compliance-Status', complianceCheck.compliant ? 'compliant' : 'non_compliant');
                    res.setHeader('X-Compliance-Violations', complianceCheck.violations.length.toString());
                    
                    if (!complianceCheck.compliant && !complianceCheck.allowedWithConditions) {
                        blocked = true;
                        blockReason = complianceCheck.blockedReasons.join(', ') || 'Compliance violations detected';
                        violations.push({
                            type: 'compliance_violation',
                            severity: 'critical',
                            details: complianceCheck
                        });
                    }
                    
                    securityEvents.push('compliance_checked');
                    
                    if (enableDetailedLogging) {
                        loggingService.info('Compliance checked', {
                            component: 'EnterpriseSecurityMiddleware',
                            requestId,
                            compliant: complianceCheck.compliant,
                            violations: complianceCheck.violations.length
                        });
                    }
                } catch (error) {
                    loggingService.error('Compliance checking failed', {
                        component: 'EnterpriseSecurityMiddleware',
                        requestId,
                        error: error instanceof Error ? error.message : String(error)
                    });
                    
                    // Fail safe for strict compliance mode
                    if (complianceMode === 'maximum') {
                        blocked = true;
                        blockReason = 'Compliance check system error';
                    }
                }
            }

            // 4. AI Provider Audit (if AI processing)
            if (enableAIProviderAudit && isAIProcessing && !bypassSpecificChecks.includes('ai_provider_audit')) {
                try {
                    const auditResult = await aiProviderAuditService.auditRequest(
                        aiProvider as any,
                        aiModel,
                        {
                            prompt: content,
                            parameters: req.body || {}
                        },
                        {
                            userTier: req.user?.tier || 'free',
                            sessionId: req.sessionId || '',
                            ipAddress: req.ip || '',
                            userAgent: req.headers['user-agent'] || '',
                            contentLength: content.length,
                            estimatedTokens: Math.ceil(content.length / 4),
                            estimatedCost: 0.1
                        },
                        req.user?.id || 'anonymous',
                        req.path
                    );
                    
                    req.aiAuditResult = auditResult;
                    
                    // Add AI audit headers
                    res.setHeader('X-AI-Audit-Status', auditResult.allowed ? 'approved' : 'blocked');
                    res.setHeader('X-AI-Risk-Level', auditResult.riskLevel);
                    res.setHeader('X-AI-Redaction-Applied', auditResult.redactionApplied.toString());
                    
                    if (!auditResult.allowed) {
                        blocked = true;
                        blockReason = auditResult.blockedReason || 'AI provider audit failed';
                        violations.push({
                            type: 'ai_audit_violation',
                            severity: 'critical',
                            details: auditResult
                        });
                    }
                    
                    securityEvents.push('ai_audit_completed');
                    
                    if (enableDetailedLogging) {
                        loggingService.info('AI provider audit completed', {
                            component: 'EnterpriseSecurityMiddleware',
                            requestId,
                            allowed: auditResult.allowed,
                            riskLevel: auditResult.riskLevel,
                            redactionApplied: auditResult.redactionApplied
                        });
                    }
                } catch (error) {
                    loggingService.error('AI provider audit failed', {
                        component: 'EnterpriseSecurityMiddleware',
                        requestId,
                        error: error instanceof Error ? error.message : String(error)
                    });
                    
                    // Fail safe for AI processing
                    if (securityLevel === 'maximum') {
                        blocked = true;
                        blockReason = 'AI audit system error';
                    }
                }
            }

            // 5. Comprehensive Audit Recording
            if (enableComprehensiveAudit && !bypassSpecificChecks.includes('comprehensive_audit')) {
                try {
                    const auditEventId = await comprehensiveAuditService.recordEvent(
                        isAIProcessing ? 'ai_processing' : 'api_call',
                        `${req.method} ${req.path}`,
                        {
                            type: 'user',
                            id: req.user?.id || 'anonymous',
                            name: req.user?.name,
                            role: req.user?.role,
                            sessionId: req.sessionId,
                            ipAddress: req.ip,
                            userAgent: req.headers['user-agent'],
                            location: {
                                country: req.headers['x-forwarded-for'] ? 'unknown' : 'US',
                                region: 'unknown',
                                city: 'unknown'
                            }
                        },
                        {
                            type: 'service',
                            id: req.path,
                            name: req.path,
                            classification: req.dataClassification?.classification.level,
                            sensitivity: req.dataClassification?.classification.riskScore.toString()
                        },
                        {
                            severity: blocked ? 'critical' : violations.length > 0 ? 'high' : 'medium',
                            outcome: blocked ? 'blocked' : 'success',
                            context: {
                                requestId,
                                businessContext: isAIProcessing ? 'ai_processing' : 'api_request',
                                technicalContext: `${req.method} ${req.path}`,
                                complianceFramework: req.dataClassification?.classification.complianceFrameworks
                            },
                            technical: {
                                sourceComponent: 'EnterpriseSecurityMiddleware',
                                method: req.method,
                                endpoint: req.path,
                                dataSize: content.length
                            },
                            evidence: {
                                beforeState: blocked ? 'request_pending' : undefined,
                                afterState: blocked ? 'request_blocked' : 'request_approved',
                                changeDetails: violations.length > 0 ? JSON.stringify(violations) : undefined
                            }
                        }
                    );
                    
                    req.auditEventId = auditEventId;
                    securityEvents.push('audit_recorded');
                    
                    if (customAuditHandler) {
                        await customAuditHandler(req, res, isAIProcessing ? 'ai_processing' : 'api_call');
                    }
                } catch (error) {
                    loggingService.error('Comprehensive audit recording failed', {
                        component: 'EnterpriseSecurityMiddleware',
                        requestId,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }

            // 6. Real-Time Monitoring and Data Flow Tracking
            if (enableRealTimeMonitoring && !bypassSpecificChecks.includes('real_time_monitoring')) {
                try {
                    // Track data flow
                    const flowId = await realTimeSecurityMonitoringService.trackDataFlow(
                        {
                            system: 'cost-katana-backend',
                            component: 'api',
                            user: req.user?.id || 'anonymous',
                            location: req.ip || 'unknown'
                        },
                        {
                            system: isAIProcessing ? aiProvider : 'internal',
                            component: isAIProcessing ? aiModel : req.path,
                            purpose: isAIProcessing ? 'ai_processing' : 'api_processing',
                            location: isAIProcessing ? 'external' : 'internal'
                        },
                        {
                            type: req.dataClassification?.classification.categories[0] || 'unknown',
                            classification: req.dataClassification?.classification.level || 'internal',
                            size: content.length,
                            pii_detected: req.filterResult?.detections.length > 0 || false,
                            encryption_status: true // Assume HTTPS
                        }
                    );
                    
                    req.dataFlowId = flowId;
                    securityEvents.push('data_flow_tracked');
                } catch (error) {
                    loggingService.error('Real-time monitoring failed', {
                        component: 'EnterpriseSecurityMiddleware',
                        requestId,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }

            // Handle violations and blocking
            if (blocked) {
                // Handle custom security violations
                if (customSecurityHandler) {
                    const handled = await customSecurityHandler(req, res, violations);
                    if (handled) return;
                }

                // Handle custom compliance violations
                if (customComplianceHandler && violations.some(v => v.type === 'compliance_violation')) {
                    const handled = await customComplianceHandler(req, res, violations.filter(v => v.type === 'compliance_violation'));
                    if (handled) return;
                }

                // Standard blocking response
                const securityResponse = {
                    error: 'Security Policy Violation',
                    message: blockReason,
                    violations: violations.map(v => ({
                        type: v.type,
                        severity: v.severity
                    })),
                    security_context: {
                        request_id: requestId,
                        security_level: securityLevel,
                        compliance_mode: complianceMode,
                        timestamp: new Date().toISOString()
                    },
                    remediation: {
                        contact: 'security@costkatana.com',
                        documentation: 'https://docs.costkatana.com/security',
                        appeal_process: 'Submit security appeal through support'
                    }
                };

                // Set security headers
                res.setHeader('X-Security-Status', 'BLOCKED');
                res.setHeader('X-Security-Reason', blockReason);
                res.setHeader('X-Security-Level', securityLevel);
                res.setHeader('X-Violations-Count', violations.length.toString());

                // Update data flow status if tracked
                if (req.dataFlowId) {
                    await realTimeSecurityMonitoringService.updateDataFlowStatus(req.dataFlowId, 'blocked');
                }

                loggingService.error('Request blocked by enterprise security', {
                    component: 'EnterpriseSecurityMiddleware',
                    requestId,
                    blockReason,
                    violations: violations.length,
                    securityLevel,
                    path: req.path
                });

                res.status(403).json(securityResponse);
                return;
            }

            // Set comprehensive security headers
            setSecurityHeaders(res, req, securityEvents);

            // Track performance if enabled
            if (enablePerformanceTracking) {
                trackSecurityPerformance(req, res, startTime, securityEvents);
            }

            // Continue to next middleware
            const middlewareTime = Date.now() - startTime;
            
            if (enableDetailedLogging) {
                loggingService.info('Enterprise security middleware completed', {
                    component: 'EnterpriseSecurityMiddleware',
                    requestId,
                    path: req.path,
                    middleware_time: middlewareTime,
                    security_events: securityEvents.length,
                    violations: violations.length,
                    blocked
                });
            }

            next();

        } catch (error) {
            const errorTime = Date.now() - startTime;
            
            loggingService.error('Enterprise security middleware error', {
                component: 'EnterpriseSecurityMiddleware',
                requestId,
                path: req.path,
                error: error instanceof Error ? error.message : String(error),
                error_time: errorTime
            });

            // Update data flow status on error
            if (req.dataFlowId) {
                await realTimeSecurityMonitoringService.updateDataFlowStatus(req.dataFlowId, 'failed', {
                    error: error instanceof Error ? error.message : String(error)
                });
            }

            // Fail safe based on security level
            if (securityLevel === 'maximum') {
                res.status(500).json({
                    error: 'Security System Error',
                    message: 'Request blocked due to security system error',
                    contact: 'security@costkatana.com'
                });
                return;
            }

            // Continue without security checks on error (for standard/high levels)
            next();
        }
    };
}

/**
 * Extract content from request for analysis
 */
function extractContentFromRequest(req: any): string {
    const contentParts: string[] = [];
    
    // Extract from body
    if (req.body) {
        if (typeof req.body === 'string') {
            contentParts.push(req.body);
        } else {
            contentParts.push(JSON.stringify(req.body));
        }
    }
    
    // Extract from query parameters
    if (req.query && Object.keys(req.query).length > 0) {
        contentParts.push(JSON.stringify(req.query));
    }
    
    // Extract from headers (selective)
    const sensitiveHeaders = ['authorization', 'x-api-key', 'x-auth-token'];
    for (const header of sensitiveHeaders) {
        if (req.headers[header]) {
            contentParts.push(`${header}: ${req.headers[header]}`);
        }
    }
    
    return contentParts.join(' ');
}

/**
 * Extract context from request
 */
function extractContextFromRequest(req: any): any {
    return {
        userId: req.user?.id || 'anonymous',
        sessionId: req.sessionId || '',
        source: req.path,
        destination: 'api_processing',
        purpose: 'api_request',
        userTier: req.user?.tier || 'free',
        ipAddress: req.ip || '',
        userAgent: req.headers['user-agent'] || ''
    };
}

/**
 * Set comprehensive security headers
 */
function setSecurityHeaders(res: Response, req: any, securityEvents: string[]): void {
    // Security status headers
    res.setHeader('X-Security-Status', 'APPROVED');
    res.setHeader('X-Security-Level', req.securityContext.securityLevel);
    res.setHeader('X-Security-Events', securityEvents.join(','));
    res.setHeader('X-Security-Timestamp', new Date().toISOString());
    
    // Data protection headers
    if (req.dataClassification) {
        res.setHeader('X-Data-Protected', 'true');
        res.setHeader('X-Data-Handling-Required', req.dataClassification.handling.auditRequired.toString());
    }
    
    // Compliance headers
    if (req.complianceCheck) {
        res.setHeader('X-Compliance-Verified', 'true');
        res.setHeader('X-Compliance-Frameworks', req.complianceCheck.violations.map((v: any) => v.framework).join(','));
    }
    
    // Audit trail headers
    if (req.auditEventId) {
        res.setHeader('X-Audit-Event-ID', req.auditEventId);
    }
    
    // Data flow headers
    if (req.dataFlowId) {
        res.setHeader('X-Data-Flow-ID', req.dataFlowId);
    }
    
    // Security metadata
    res.setHeader('X-Protected-By', 'Enterprise-Security-Suite');
    res.setHeader('X-Security-Version', '1.0.0');
}

/**
 * Track security performance
 */
function trackSecurityPerformance(req: any, res: Response, startTime: number, securityEvents: string[]): void {
    const originalSend = res.send;
    const originalJson = res.json;
    
    const trackCompletion = () => {
        const duration = Date.now() - startTime;
        res.setHeader('X-Security-Processing-Time', duration.toString());
        res.setHeader('X-Security-Events-Count', securityEvents.length.toString());
        
        // Update data flow with completion
        if (req.dataFlowId) {
            realTimeSecurityMonitoringService.updateDataFlowStatus(req.dataFlowId, 'completed', {
                duration,
                responseSize: res.get('content-length') ? parseInt(res.get('content-length')!) : 0
            });
        }
    };
    
    res.send = function(data: any) {
        trackCompletion();
        return originalSend.call(this, data);
    };
    
    res.json = function(data: any) {
        trackCompletion();
        return originalJson.call(this, data);
    };
}

/**
 * Check if endpoint is emergency (bypasses all security)
 */
function isEmergencyEndpoint(path: string): boolean {
    const emergencyPaths = [
        '/api/emergency',
        '/api/health/critical',
        '/api/system/emergency'
    ];
    
    return emergencyPaths.some(emergency => path.startsWith(emergency));
}

/**
 * Generate request ID
 */
function generateRequestId(): string {
    return `sec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Specialized security middleware variants
 */

/**
 * AI processing security middleware
 */
export function aiProcessingSecurityMiddleware(
    provider: string,
    model: string,
    options: Omit<SecurityMiddlewareOptions, 'isAIProcessing' | 'aiProvider' | 'aiModel'> = {}
): (req: any, res: Response, next: NextFunction) => void {
    return enterpriseSecurityMiddleware({
        ...options,
        isAIProcessing: true,
        aiProvider: provider,
        aiModel: model,
        securityLevel: options.securityLevel || 'maximum', // Default to maximum for AI
        complianceMode: options.complianceMode || 'strict'
    });
}

/**
 * High-security API middleware
 */
export function highSecurityApiMiddleware(
    options: SecurityMiddlewareOptions = {}
): (req: any, res: Response, next: NextFunction) => void {
    return enterpriseSecurityMiddleware({
        ...options,
        securityLevel: 'maximum',
        complianceMode: 'maximum',
        enableDetailedLogging: options.enableDetailedLogging ?? true
    });
}

/**
 * Standard security middleware
 */
export function standardSecurityMiddleware(
    options: SecurityMiddlewareOptions = {}
): (req: any, res: Response, next: NextFunction) => void {
    return enterpriseSecurityMiddleware({
        ...options,
        securityLevel: 'standard',
        complianceMode: 'permissive'
    });
}

/**
 * Get real-time security dashboard
 */
export async function getSecurityDashboard(): Promise<any> {
    return realTimeSecurityMonitoringService.getMonitoringDashboard();
}

/**
 * Get security statistics
 */
export function getSecurityStatistics(): any {
    return {
        audit: comprehensiveAuditService.getStatistics(),
        compliance: complianceEnforcementService.getStatistics(),
        ai_audit: aiProviderAuditService.getStatistics(),
        filtering: preTransmissionFilterService.getStatistics(),
        classification: dataClassificationService.getStatistics(),
        monitoring: realTimeSecurityMonitoringService.getStatistics()
    };
}
