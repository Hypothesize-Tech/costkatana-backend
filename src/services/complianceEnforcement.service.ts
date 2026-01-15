import { loggingService } from './logging.service';
import { cacheService } from './cache.service';
import { dataClassificationService, ComplianceFramework } from './dataClassification.service';
import { EventEmitter } from 'events';
import * as crypto from 'crypto';

/**
 * Compliance Enforcement Service
 * Automated compliance checking and enforcement for GDPR, HIPAA, SOC 2, etc.
 */

export interface ComplianceRule {
    id: string;
    name: string;
    description: string;
    framework: ComplianceFramework;
    category: 'data_protection' | 'consent' | 'retention' | 'access_control' | 'audit' | 'breach_notification';
    severity: 'low' | 'medium' | 'high' | 'critical';
    
    // Rule conditions
    conditions: {
        dataTypes?: string[];
        userTypes?: string[];
        geographicScope?: string[];
        processingPurpose?: string[];
        dataVolume?: { min?: number; max?: number };
        retentionPeriod?: { min?: number; max?: number };
    };
    
    // Enforcement actions
    enforcement: {
        preventProcessing: boolean;
        requireConsent: boolean;
        requireEncryption: boolean;
        requireAudit: boolean;
        requireApproval: boolean;
        requireNotification: boolean;
        maxRetentionDays: number;
        allowedRegions: string[];
        requiredSafeguards: string[];
    };
    
    // Violation handling
    violation: {
        severity: 'minor' | 'major' | 'critical';
        autoRemediate: boolean;
        notifyAuthorities: boolean;
        notifyDataSubject: boolean;
        escalateToLegal: boolean;
        remediationSteps: string[];
    };
    
    enabled: boolean;
    lastUpdated: number;
}

export interface ComplianceCheck {
    checkId: string;
    timestamp: number;
    framework: ComplianceFramework;
    contentHash: string;
    
    // Check results
    result: {
        compliant: boolean;
        violationsFound: ComplianceViolation[];
        riskLevel: 'low' | 'medium' | 'high' | 'critical';
        confidence: number;
        recommendations: string[];
    };
    
    // Context
    context: {
        userId: string;
        dataType: string;
        processingPurpose: string;
        userLocation: string;
        userConsent: boolean;
        dataClassification: any;
    };
    
    // Actions taken
    actions: {
        blocked: boolean;
        redacted: boolean;
        encrypted: boolean;
        auditLogged: boolean;
        consentRequested: boolean;
        approvalRequested: boolean;
        notificationSent: boolean;
    };
}

export interface ComplianceViolation {
    violationId: string;
    ruleId: string;
    framework: ComplianceFramework;
    category: string;
    severity: 'minor' | 'major' | 'critical';
    description: string;
    evidence: string[];
    timestamp: number;
    potentialFines: {
        currency: string;
        minAmount: number;
        maxAmount: number;
    };
    remediationRequired: boolean;
    reportingRequired: boolean;
    timeToRemediate: number; // hours
    legalRisk: number; // 0-1
}

export interface ConsentRecord {
    consentId: string;
    userId: string;
    timestamp: number;
    
    // Consent details
    consent: {
        framework: ComplianceFramework;
        purpose: string[];
        dataTypes: string[];
        processingBasis: string;
        duration: number; // days
        withdrawable: boolean;
        explicit: boolean;
        informed: boolean;
    };
    
    // User information
    user: {
        age: number;
        location: string;
        ipAddress: string;
        userAgent: string;
        language: string;
    };
    
    // Consent status
    status: {
        granted: boolean;
        withdrawn: boolean;
        expired: boolean;
        renewalRequired: boolean;
        lastUpdated: number;
    };
    
    // Audit trail
    audit: {
        grantedAt?: number;
        withdrawnAt?: number;
        renewedAt?: number;
        method: 'explicit' | 'implicit' | 'opt_in' | 'opt_out';
        evidence: string[];
    };
}

export interface ComplianceReport {
    reportId: string;
    framework: ComplianceFramework;
    generatedAt: number;
    period: {
        start: number;
        end: number;
    };
    
    // Summary metrics
    summary: {
        totalDataProcessed: number;
        complianceChecks: number;
        violations: number;
        criticalViolations: number;
        consentRequests: number;
        consentGranted: number;
        dataSubjectRequests: number;
        breachesDetected: number;
    };
    
    // Detailed findings
    findings: {
        violations: ComplianceViolation[];
        riskAreas: Array<{
            area: string;
            riskLevel: string;
            description: string;
            recommendations: string[];
        }>;
        complianceGaps: Array<{
            requirement: string;
            currentState: string;
            requiredState: string;
            remediation: string;
        }>;
    };
    
    // Recommendations
    recommendations: {
        immediate: string[];
        shortTerm: string[];
        longTerm: string[];
        regulatory: string[];
    };
}

export class ComplianceEnforcementService extends EventEmitter {
    private static instance: ComplianceEnforcementService;
    
    private complianceRules: Map<string, ComplianceRule> = new Map();
    private violationHistory: ComplianceViolation[] = [];
    private consentRecords: Map<string, ConsentRecord> = new Map();
    private complianceChecks: Map<string, ComplianceCheck> = new Map();
    
    private readonly MAX_HISTORY_SIZE = 100000;
    
    // Statistics
    private stats = {
        totalChecks: 0,
        violationsDetected: 0,
        criticalViolations: 0,
        autoRemediations: 0,
        manualEscalations: 0,
        consentRequests: 0,
        consentGranted: 0,
        averageCheckTime: 0,
        uptime: Date.now()
    };

    // Default compliance rules
    private defaultRules: Omit<ComplianceRule, 'id' | 'lastUpdated'>[] = [
        // GDPR Rules
        {
            name: 'GDPR Data Processing Consent',
            description: 'Requires explicit consent for processing personal data under GDPR',
            framework: 'gdpr',
            category: 'consent',
            severity: 'critical',
            conditions: {
                dataTypes: ['pii', 'personal'],
                geographicScope: ['eu', 'eea'],
                processingPurpose: ['marketing', 'profiling', 'automated_decision']
            },
            enforcement: {
                preventProcessing: true,
                requireConsent: true,
                requireEncryption: true,
                requireAudit: true,
                requireApproval: false,
                requireNotification: false,
                maxRetentionDays: 365,
                allowedRegions: ['eu', 'eea'],
                requiredSafeguards: ['encryption', 'access_control', 'audit_logging']
            },
            violation: {
                severity: 'critical',
                autoRemediate: false,
                notifyAuthorities: true,
                notifyDataSubject: true,
                escalateToLegal: true,
                remediationSteps: ['Stop processing', 'Delete data', 'Notify authorities', 'Notify data subject']
            },
            enabled: true
        },
        {
            name: 'GDPR Data Retention Limits',
            description: 'Enforces GDPR data retention limitations',
            framework: 'gdpr',
            category: 'retention',
            severity: 'high',
            conditions: {
                dataTypes: ['pii'],
                geographicScope: ['eu', 'eea']
            },
            enforcement: {
                preventProcessing: false,
                requireConsent: false,
                requireEncryption: true,
                requireAudit: true,
                requireApproval: false,
                requireNotification: true,
                maxRetentionDays: 365,
                allowedRegions: ['eu', 'eea'],
                requiredSafeguards: ['automated_deletion', 'access_control']
            },
            violation: {
                severity: 'major',
                autoRemediate: true,
                notifyAuthorities: false,
                notifyDataSubject: true,
                escalateToLegal: false,
                remediationSteps: ['Delete expired data', 'Update retention policies']
            },
            enabled: true
        },
        
        // HIPAA Rules
        {
            name: 'HIPAA PHI Protection',
            description: 'Protects Protected Health Information under HIPAA',
            framework: 'hipaa',
            category: 'data_protection',
            severity: 'critical',
            conditions: {
                dataTypes: ['phi', 'medical'],
                geographicScope: ['us'],
                processingPurpose: ['healthcare', 'medical', 'treatment']
            },
            enforcement: {
                preventProcessing: false,
                requireConsent: true,
                requireEncryption: true,
                requireAudit: true,
                requireApproval: true,
                requireNotification: false,
                maxRetentionDays: 2555, // 7 years
                allowedRegions: ['us'],
                requiredSafeguards: ['encryption_at_rest', 'encryption_in_transit', 'access_control', 'audit_logging', 'backup_encryption']
            },
            violation: {
                severity: 'critical',
                autoRemediate: false,
                notifyAuthorities: true,
                notifyDataSubject: true,
                escalateToLegal: true,
                remediationSteps: ['Secure data', 'Investigate breach', 'Notify HHS', 'Notify affected individuals']
            },
            enabled: true
        },
        
        // SOC 2 Rules
        {
            name: 'SOC 2 Security Controls',
            description: 'Enforces SOC 2 security control requirements',
            framework: 'soc2',
            category: 'access_control',
            severity: 'high',
            conditions: {
                dataTypes: ['customer_data', 'business'],
                processingPurpose: ['service_delivery', 'support']
            },
            enforcement: {
                preventProcessing: false,
                requireConsent: false,
                requireEncryption: true,
                requireAudit: true,
                requireApproval: false,
                requireNotification: false,
                maxRetentionDays: 2555,
                allowedRegions: [],
                requiredSafeguards: ['access_control', 'monitoring', 'incident_response']
            },
            violation: {
                severity: 'major',
                autoRemediate: true,
                notifyAuthorities: false,
                notifyDataSubject: false,
                escalateToLegal: false,
                remediationSteps: ['Implement missing controls', 'Update documentation', 'Retrain staff']
            },
            enabled: true
        },
        
        // PCI DSS Rules
        {
            name: 'PCI DSS Cardholder Data Protection',
            description: 'Protects cardholder data under PCI DSS',
            framework: 'pci_dss',
            category: 'data_protection',
            severity: 'critical',
            conditions: {
                dataTypes: ['financial', 'payment_card'],
                processingPurpose: ['payment', 'billing']
            },
            enforcement: {
                preventProcessing: true,
                requireConsent: false,
                requireEncryption: true,
                requireAudit: true,
                requireApproval: true,
                requireNotification: false,
                maxRetentionDays: 365,
                allowedRegions: [],
                requiredSafeguards: ['strong_encryption', 'secure_transmission', 'access_control', 'vulnerability_management']
            },
            violation: {
                severity: 'critical',
                autoRemediate: false,
                notifyAuthorities: true,
                notifyDataSubject: true,
                escalateToLegal: true,
                remediationSteps: ['Secure cardholder data', 'Investigate breach', 'Notify card brands', 'Implement additional controls']
            },
            enabled: true
        }
    ];

    private constructor() {
        super();
        this.initializeDefaultRules();
        this.startComplianceMonitoring();
    }

    public static getInstance(): ComplianceEnforcementService {
        if (!ComplianceEnforcementService.instance) {
            ComplianceEnforcementService.instance = new ComplianceEnforcementService();
        }
        return ComplianceEnforcementService.instance;
    }

    /**
     * Perform comprehensive compliance check
     */
    public async performComplianceCheck(
        content: string,
        context: {
            userId: string;
            userLocation: string;
            processingPurpose: string;
            dataSource: string;
            destination: string;
            userTier: string;
        }
    ): Promise<{
        checkId: string;
        compliant: boolean;
        violations: ComplianceViolation[];
        requiredActions: string[];
        blockedReasons: string[];
        allowedWithConditions: boolean;
        conditions: string[];
    }> {
        const checkId = this.generateCheckId();
        const startTime = Date.now();

        try {
            // First, classify the content
            const classification = await dataClassificationService.classifyContent(content, {
                userId: context.userId,
                sessionId: '',
                source: context.dataSource,
                destination: context.destination,
                purpose: context.processingPurpose,
                userTier: context.userTier,
                ipAddress: '',
                userAgent: ''
            });

            // Get user consent status
            const consentStatus = await this.getUserConsentStatus(context.userId, classification.classification.complianceFrameworks);

            // Check applicable compliance rules
            const applicableRules = this.getApplicableRules(classification, context);
            const violations: ComplianceViolation[] = [];
            const requiredActions: string[] = [];
            const blockedReasons: string[] = [];
            const conditions: string[] = [];

            let compliant = true;
            let allowedWithConditions = true;

            // Evaluate each applicable rule
            for (const rule of applicableRules) {
                const ruleCheck = await this.evaluateComplianceRule(rule, classification, context, consentStatus);
                
                if (!ruleCheck.compliant) {
                    compliant = false;
                    
                    if (ruleCheck.violation) {
                        violations.push(ruleCheck.violation);
                    }
                    
                    if (rule.enforcement.preventProcessing) {
                        allowedWithConditions = false;
                        blockedReasons.push(`${rule.framework.toUpperCase()} violation: ${rule.name}`);
                    } else {
                        // Add required conditions
                        if (rule.enforcement.requireConsent && !consentStatus.hasValidConsent) {
                            conditions.push('Explicit user consent required');
                            requiredActions.push('Obtain user consent');
                        }
                        
                        if (rule.enforcement.requireEncryption) {
                            conditions.push('Data must be encrypted');
                            requiredActions.push('Apply encryption');
                        }
                        
                        if (rule.enforcement.requireAudit) {
                            conditions.push('Full audit trail required');
                            requiredActions.push('Enable comprehensive auditing');
                        }
                        
                        if (rule.enforcement.requireApproval) {
                            conditions.push('Management approval required');
                            requiredActions.push('Obtain management approval');
                        }
                    }
                }
            }

            // Create compliance check record
            const complianceCheck: ComplianceCheck = {
                checkId,
                timestamp: Date.now(),
                framework: this.getPrimaryFramework(applicableRules),
                contentHash: classification.contentHash,
                result: {
                    compliant,
                    violationsFound: violations,
                    riskLevel: this.calculateComplianceRiskLevel(violations),
                    confidence: classification.classification.confidenceScore,
                    recommendations: this.generateComplianceRecommendations(violations, classification)
                },
                context: {
                    userId: context.userId,
                    dataType: classification.classification.categories.join(','),
                    processingPurpose: context.processingPurpose,
                    userLocation: context.userLocation,
                    userConsent: consentStatus.hasValidConsent,
                    dataClassification: classification.classification
                },
                actions: {
                    blocked: !allowedWithConditions,
                    redacted: classification.handling.redactionRequired,
                    encrypted: classification.handling.encryptionRequired,
                    auditLogged: true,
                    consentRequested: requiredActions.includes('Obtain user consent'),
                    approvalRequested: requiredActions.includes('Obtain management approval'),
                    notificationSent: violations.some(v => v.reportingRequired)
                }
            };

            // Store compliance check
            await this.storeComplianceCheck(complianceCheck);
            this.complianceChecks.set(checkId, complianceCheck);

            // Handle violations
            if (violations.length > 0) {
                await this.handleViolations(violations, context);
            }

            // Update statistics
            this.updateStatistics(complianceCheck, Date.now() - startTime);

            // Emit compliance event
            this.emit('compliance_check_completed', {
                checkId,
                compliant,
                violationCount: violations.length,
                framework: complianceCheck.framework,
                riskLevel: complianceCheck.result.riskLevel
            });

            // Log significant compliance events
            if (!compliant || violations.some(v => v.severity === 'critical')) {
                loggingService.error('COMPLIANCE VIOLATION DETECTED', {
                    component: 'ComplianceEnforcementService',
                    checkId,
                    framework: complianceCheck.framework,
                    violations: violations.length,
                    criticalViolations: violations.filter(v => v.severity === 'critical').length,
                    context: context.processingPurpose
                });
            }

            return {
                checkId,
                compliant,
                violations,
                requiredActions: [...new Set(requiredActions)],
                blockedReasons,
                allowedWithConditions,
                conditions: [...new Set(conditions)]
            };

        } catch (error) {
            loggingService.error('Compliance check failed', {
                component: 'ComplianceEnforcementService',
                error: error instanceof Error ? error.message : String(error),
                context
            });

            // Return safe default (block processing)
            return {
                checkId,
                compliant: false,
                violations: [],
                requiredActions: ['Manual compliance review required'],
                blockedReasons: ['Compliance check system error'],
                allowedWithConditions: false,
                conditions: []
            };
        }
    }

    /**
     * Evaluate a single compliance rule
     */
    private async evaluateComplianceRule(
        rule: ComplianceRule,
        classification: any,
        context: any,
        consentStatus: any
    ): Promise<{ compliant: boolean; violation?: ComplianceViolation }> {
        try {
            // Check if rule conditions are met
            if (!this.ruleConditionsMet(rule, classification, context)) {
                return { compliant: true }; // Rule doesn't apply
            }

            let compliant = true;
            const violationReasons: string[] = [];

            // Check consent requirements
            if (rule.enforcement.requireConsent && !consentStatus.hasValidConsent) {
                compliant = false;
                violationReasons.push('Required consent not obtained');
            }

            // Check encryption requirements
            if (rule.enforcement.requireEncryption && !classification.handling.encryptionRequired) {
                compliant = false;
                violationReasons.push('Required encryption not applied');
            }

            // Check geographic restrictions
            if (rule.enforcement.allowedRegions.length > 0 && 
                !rule.enforcement.allowedRegions.includes(context.userLocation)) {
                compliant = false;
                violationReasons.push('Geographic restrictions violated');
            }

            // Check retention period
            if (classification.handling.retentionPeriod > rule.enforcement.maxRetentionDays) {
                compliant = false;
                violationReasons.push('Data retention period exceeds maximum allowed');
            }

            // Check required safeguards
            for (const safeguard of rule.enforcement.requiredSafeguards) {
                if (!this.hasSafeguard(safeguard, classification, context)) {
                    compliant = false;
                    violationReasons.push(`Required safeguard missing: ${safeguard}`);
                }
            }

            if (!compliant) {
                const violation: ComplianceViolation = {
                    violationId: this.generateViolationId(),
                    ruleId: rule.id,
                    framework: rule.framework,
                    category: rule.category,
                    severity: rule.violation.severity,
                    description: `${rule.name}: ${violationReasons.join(', ')}`,
                    evidence: violationReasons,
                    timestamp: Date.now(),
                    potentialFines: this.calculatePotentialFines(rule.framework, rule.violation.severity),
                    remediationRequired: true,
                    reportingRequired: rule.violation.notifyAuthorities,
                    timeToRemediate: this.calculateRemediationTime(rule.violation.severity),
                    legalRisk: this.calculateLegalRisk(rule.framework, rule.violation.severity)
                };

                return { compliant: false, violation };
            }

            return { compliant: true };

        } catch (error) {
            loggingService.error('Compliance rule evaluation failed', {
                component: 'ComplianceEnforcementService',
                ruleId: rule.id,
                error: error instanceof Error ? error.message : String(error)
            });

            // Fail safe - assume non-compliant
            return { compliant: false };
        }
    }

    /**
     * Check if rule conditions are met
     */
    private ruleConditionsMet(rule: ComplianceRule, classification: any, context: any): boolean {
        const conditions = rule.conditions;

        // Check data types
        if (conditions.dataTypes && conditions.dataTypes.length > 0) {
            const hasMatchingType = conditions.dataTypes.some(type => 
                classification.classification.categories.includes(type)
            );
            if (!hasMatchingType) return false;
        }

        // Check geographic scope
        if (conditions.geographicScope && conditions.geographicScope.length > 0) {
            if (!conditions.geographicScope.includes(context.userLocation)) return false;
        }

        // Check processing purpose
        if (conditions.processingPurpose && conditions.processingPurpose.length > 0) {
            const hasMatchingPurpose = conditions.processingPurpose.some(purpose => 
                context.processingPurpose.includes(purpose)
            );
            if (!hasMatchingPurpose) return false;
        }

        // Check data volume (if applicable)
        if (conditions.dataVolume) {
            const contentLength = classification.content.length;
            if (conditions.dataVolume.min && contentLength < conditions.dataVolume.min) return false;
            if (conditions.dataVolume.max && contentLength > conditions.dataVolume.max) return false;
        }

        return true;
    }

    /**
     * Get user consent status
     */
    private async getUserConsentStatus(userId: string, frameworks: ComplianceFramework[]): Promise<{
        hasValidConsent: boolean;
        consentDetails: Record<ComplianceFramework, ConsentRecord | null>;
        expiringConsents: ComplianceFramework[];
    }> {
        const consentDetails: Record<ComplianceFramework, ConsentRecord | null> = {} as any;
        const expiringConsents: ComplianceFramework[] = [];
        let hasValidConsent = true;

        for (const framework of frameworks) {
            const consent = await this.getConsentRecord(userId, framework);
            consentDetails[framework] = consent;

            if (!consent || !consent.status.granted || consent.status.withdrawn || consent.status.expired) {
                hasValidConsent = false;
            } else if (consent.status.renewalRequired) {
                expiringConsents.push(framework);
            }
        }

        return {
            hasValidConsent,
            consentDetails,
            expiringConsents
        };
    }

    /**
     * Get consent record for user and framework
     */
    private async getConsentRecord(userId: string, framework: ComplianceFramework): Promise<ConsentRecord | null> {
        try {
            const cacheKey = `consent:${userId}:${framework}`;
            const cached = await cacheService.get(cacheKey);
            return cached as ConsentRecord || null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Handle compliance violations
     */
    private async handleViolations(violations: ComplianceViolation[], context: any): Promise<void> {
        for (const violation of violations) {
            // Add to violation history
            this.violationHistory.push(violation);
            
            // Clean up history
            if (this.violationHistory.length > this.MAX_HISTORY_SIZE) {
                this.violationHistory = this.violationHistory.slice(-this.MAX_HISTORY_SIZE);
            }

            // Store violation
            await this.storeViolation(violation);

            // Handle based on severity
            if (violation.severity === 'critical') {
                await this.handleCriticalViolation(violation, context);
            } else if (violation.severity === 'major') {
                await this.handleMajorViolation(violation, context);
            } else {
                await this.handleMinorViolation(violation, context);
            }

            // Emit violation event
            this.emit('compliance_violation', {
                violationId: violation.violationId,
                framework: violation.framework,
                severity: violation.severity,
                category: violation.category,
                remediationRequired: violation.remediationRequired
            });
        }
    }

    /**
     * Handle critical compliance violations
     */
    private async handleCriticalViolation(violation: ComplianceViolation, context: any): Promise<void> {
        loggingService.error('CRITICAL COMPLIANCE VIOLATION', {
            component: 'ComplianceEnforcementService',
            violationId: violation.violationId,
            framework: violation.framework,
            description: violation.description,
            potentialFines: violation.potentialFines,
            context
        });

        // Immediate actions for critical violations
        await Promise.all([
            this.sendImmediateAlert(violation, context),
            this.escalateToLegal(violation, context),
            this.notifySecurityTeam(violation, context)
        ]);

        // Auto-remediation if enabled
        const rule = this.complianceRules.get(violation.ruleId);
        if (rule?.violation.autoRemediate) {
            await this.performAutoRemediation(violation, rule);
        }
    }

    /**
     * Generate compliance report for specific framework
     */
    public async generateComplianceReport(
        framework: ComplianceFramework,
        period: { start: number; end: number }
    ): Promise<ComplianceReport> {
        const reportId = this.generateReportId();
        
        try {
            // Get relevant checks and violations
            const relevantChecks = Array.from(this.complianceChecks.values())
                .filter(check => 
                    check.framework === framework &&
                    check.timestamp >= period.start &&
                    check.timestamp <= period.end
                );

            const relevantViolations = this.violationHistory
                .filter(violation => 
                    violation.framework === framework &&
                    violation.timestamp >= period.start &&
                    violation.timestamp <= period.end
                );

            // Calculate summary metrics
            const summary = {
                totalDataProcessed: relevantChecks.length,
                complianceChecks: relevantChecks.length,
                violations: relevantViolations.length,
                criticalViolations: relevantViolations.filter(v => v.severity === 'critical').length,
                consentRequests: relevantChecks.filter(c => c.actions.consentRequested).length,
                consentGranted: relevantChecks.filter(c => c.context.userConsent).length,
                dataSubjectRequests: 0, // Would come from separate system
                breachesDetected: relevantViolations.filter(v => v.severity === 'critical').length
            };

            // Analyze findings
            const findings = {
                violations: relevantViolations,
                riskAreas: this.identifyRiskAreas(relevantViolations),
                complianceGaps: this.identifyComplianceGaps(framework, relevantChecks)
            };

            // Generate recommendations
            const recommendations = this.generateFrameworkRecommendations(framework, findings);

            const report: ComplianceReport = {
                reportId,
                framework,
                generatedAt: Date.now(),
                period,
                summary,
                findings,
                recommendations
            };

            // Store report
            await this.storeComplianceReport(report);

            // Emit report event
            this.emit('compliance_report_generated', {
                reportId,
                framework,
                violationCount: summary.violations,
                criticalViolations: summary.criticalViolations
            });

            return report;

        } catch (error) {
            loggingService.error('Failed to generate compliance report', {
                component: 'ComplianceEnforcementService',
                framework,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Record user consent
     */
    public async recordUserConsent(
        userId: string,
        framework: ComplianceFramework,
        consentDetails: Omit<ConsentRecord['consent'], 'framework'>,
        userInfo: ConsentRecord['user'],
        method: ConsentRecord['audit']['method']
    ): Promise<string> {
        const consentId = this.generateConsentId();
        const timestamp = Date.now();

        const consentRecord: ConsentRecord = {
            consentId,
            userId,
            timestamp,
            consent: {
                framework,
                ...consentDetails
            },
            user: userInfo,
            status: {
                granted: true,
                withdrawn: false,
                expired: false,
                renewalRequired: false,
                lastUpdated: timestamp
            },
            audit: {
                grantedAt: timestamp,
                method,
                evidence: [`Consent granted via ${method} at ${new Date(timestamp).toISOString()}`]
            }
        };

        // Store consent record
        this.consentRecords.set(`${userId}:${framework}`, consentRecord);
        await this.storeConsentRecord(consentRecord);

        loggingService.info('User consent recorded', {
            component: 'ComplianceEnforcementService',
            consentId,
            userId,
            framework,
            method,
            purpose: consentDetails.purpose.join(',')
        });

        this.emit('consent_recorded', {
            consentId,
            userId,
            framework,
            method
        });

        return consentId;
    }

    /**
     * Withdraw user consent
     */
    public async withdrawUserConsent(
        userId: string,
        framework: ComplianceFramework,
        reason: string = 'User requested withdrawal'
    ): Promise<boolean> {
        try {
            const consentKey = `${userId}:${framework}`;
            const consentRecord = this.consentRecords.get(consentKey);
            
            if (!consentRecord) {
                return false; // No consent to withdraw
            }

            // Update consent record
            consentRecord.status.withdrawn = true;
            consentRecord.status.lastUpdated = Date.now();
            consentRecord.audit.withdrawnAt = Date.now();
            consentRecord.audit.evidence.push(`Consent withdrawn: ${reason} at ${new Date().toISOString()}`);

            // Store updated record
            await this.storeConsentRecord(consentRecord);

            loggingService.info('User consent withdrawn', {
                component: 'ComplianceEnforcementService',
                consentId: consentRecord.consentId,
                userId,
                framework,
                reason
            });

            this.emit('consent_withdrawn', {
                consentId: consentRecord.consentId,
                userId,
                framework,
                reason
            });

            return true;

        } catch (error) {
            loggingService.error('Failed to withdraw user consent', {
                component: 'ComplianceEnforcementService',
                userId,
                framework,
                error: error instanceof Error ? error.message : String(error)
            });
            return false;
        }
    }

    // Helper methods
    private getApplicableRules(classification: any, context: any): ComplianceRule[] {
        return Array.from(this.complianceRules.values())
            .filter(rule => rule.enabled && this.ruleConditionsMet(rule, classification, context));
    }

    private getPrimaryFramework(rules: ComplianceRule[]): ComplianceFramework {
        if (rules.length === 0) return 'soc2'; // Default
        
        // Priority order for frameworks
        const priority = ['hipaa', 'pci_dss', 'gdpr', 'ccpa', 'sox', 'soc2', 'iso27001'];
        
        for (const framework of priority) {
            if (rules.some(rule => rule.framework === framework)) {
                return framework as ComplianceFramework;
            }
        }
        
        return rules[0].framework;
    }

    private calculateComplianceRiskLevel(violations: ComplianceViolation[]): 'low' | 'medium' | 'high' | 'critical' {
        if (violations.some(v => v.severity === 'critical')) return 'critical';
        if (violations.some(v => v.severity === 'major')) return 'high';
        if (violations.length > 3) return 'medium';
        if (violations.length > 0) return 'low';
        return 'low';
    }

    private generateComplianceRecommendations(violations: ComplianceViolation[], classification: any): string[] {
        const recommendations: string[] = [];
        
        if (violations.some(v => v.category === 'consent')) {
            recommendations.push('Implement comprehensive consent management system');
        }
        
        if (violations.some(v => v.category === 'data_protection')) {
            recommendations.push('Enhance data protection measures and encryption');
        }
        
        if (violations.some(v => v.category === 'retention')) {
            recommendations.push('Review and update data retention policies');
        }
        
        if (classification.classification.riskScore > 0.8) {
            recommendations.push('Consider additional safeguards for high-risk data');
        }
        
        return recommendations;
    }

    private calculatePotentialFines(framework: ComplianceFramework, severity: string): { currency: string; minAmount: number; maxAmount: number } {
        const fineStructures = {
            gdpr: { critical: { min: 10000000, max: 20000000 }, major: { min: 1000000, max: 10000000 }, minor: { min: 10000, max: 100000 } },
            hipaa: { critical: { min: 100000, max: 1500000 }, major: { min: 50000, max: 500000 }, minor: { min: 5000, max: 50000 } },
            pci_dss: { critical: { min: 50000, max: 500000 }, major: { min: 10000, max: 100000 }, minor: { min: 1000, max: 10000 } },
            ccpa: { critical: { min: 100000, max: 7500000 }, major: { min: 10000, max: 100000 }, minor: { min: 2500, max: 25000 } }
        };

        const frameworkFines = fineStructures[framework as keyof typeof fineStructures];
        if (frameworkFines) {
            const severityFines = frameworkFines[severity as keyof typeof frameworkFines];
            if (severityFines) {
                return {
                    currency: 'USD',
                    minAmount: severityFines.min,
                    maxAmount: severityFines.max
                };
            }
        }

        return { currency: 'USD', minAmount: 1000, maxAmount: 10000 };
    }

    private calculateRemediationTime(severity: string): number {
        const times = {
            critical: 4,  // 4 hours
            major: 24,    // 24 hours
            minor: 72     // 72 hours
        };
        return times[severity as keyof typeof times] || 24;
    }

    private calculateLegalRisk(framework: ComplianceFramework, severity: string): number {
        const riskMatrix = {
            gdpr: { critical: 0.9, major: 0.7, minor: 0.3 },
            hipaa: { critical: 0.8, major: 0.6, minor: 0.2 },
            pci_dss: { critical: 0.7, major: 0.5, minor: 0.2 },
            ccpa: { critical: 0.6, major: 0.4, minor: 0.1 }
        };

        const frameworkRisk = riskMatrix[framework as keyof typeof riskMatrix];
        return frameworkRisk ? frameworkRisk[severity as keyof typeof frameworkRisk] || 0.1 : 0.1;
    }

    private hasSafeguard(safeguard: string, classification: any, _context: any): boolean {
        // Check if required safeguard is in place
        switch (safeguard) {
            case 'encryption':
            case 'encryption_at_rest':
            case 'encryption_in_transit':
                return classification.handling.encryptionRequired;
            case 'access_control':
                return classification.handling.accessRestrictions.length > 0;
            case 'audit_logging':
                return classification.handling.auditRequired;
            case 'automated_deletion':
                return classification.handling.retentionPeriod > 0;
            default:
                return false; // Unknown safeguard
        }
    }

    private identifyRiskAreas(violations: ComplianceViolation[]): any[] {
        const riskAreas: any[] = [];
        
        // Group violations by category
        const byCategory = violations.reduce((acc, v) => {
            acc[v.category] = (acc[v.category] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        for (const [category, count] of Object.entries(byCategory)) {
            if (count > 5) {
                riskAreas.push({
                    area: category,
                    riskLevel: count > 20 ? 'critical' : count > 10 ? 'high' : 'medium',
                    description: `High number of ${category} violations detected`,
                    recommendations: [`Review and strengthen ${category} controls`]
                });
            }
        }

        return riskAreas;
    }

    private identifyComplianceGaps(framework: ComplianceFramework, checks: ComplianceCheck[]): any[] {
        const gaps: any[] = [];
        
        // Analyze compliance gaps based on framework requirements
        const frameworkRequirements = this.getFrameworkRequirements(framework);
        
        for (const requirement of frameworkRequirements) {
            const compliance = this.assessRequirementCompliance(requirement, checks);
            
            if (compliance.score < 0.8) { // Less than 80% compliant
                gaps.push({
                    requirement: requirement.name,
                    currentState: compliance.currentState,
                    requiredState: requirement.requiredState,
                    remediation: requirement.remediation,
                    complianceScore: compliance.score,
                    priority: compliance.score < 0.5 ? 'high' : 'medium'
                });
            }
        }
        
        return gaps;
    }

    private getFrameworkRequirements(framework: ComplianceFramework): any[] {
        const requirements: Record<ComplianceFramework, any[]> = {
            gdpr: [
                {
                    name: 'Data Processing Records',
                    requiredState: 'Comprehensive audit trail for all personal data processing',
                    remediation: 'Implement detailed data processing logs with retention policies'
                },
                {
                    name: 'Consent Management',
                    requiredState: 'Explicit consent for all personal data processing',
                    remediation: 'Implement consent management system with withdrawal capabilities'
                },
                {
                    name: 'Data Subject Rights',
                    requiredState: 'Automated handling of data subject requests',
                    remediation: 'Implement data portability, erasure, and access request handling'
                }
            ],
            hipaa: [
                {
                    name: 'PHI Access Controls',
                    requiredState: 'Role-based access control for all PHI',
                    remediation: 'Implement minimum necessary access principles'
                },
                {
                    name: 'Audit Logs',
                    requiredState: 'Comprehensive audit logs for all PHI access',
                    remediation: 'Implement detailed audit logging for healthcare data'
                }
            ],
            soc2: [
                {
                    name: 'Security Controls',
                    requiredState: 'Implemented security controls across all systems',
                    remediation: 'Document and test security control effectiveness'
                }
            ],
            pci_dss: [
                {
                    name: 'Cardholder Data Protection',
                    requiredState: 'Encrypted storage and transmission of cardholder data',
                    remediation: 'Implement PCI DSS security standards'
                }
            ],
            ccpa: [
                {
                    name: 'Consumer Rights',
                    requiredState: 'Automated consumer request handling',
                    remediation: 'Implement consumer privacy request system'
                }
            ],
            sox: [
                {
                    name: 'Financial Controls',
                    requiredState: 'Internal controls over financial reporting',
                    remediation: 'Implement financial data access controls'
                }
            ],
            iso27001: [
                {
                    name: 'Information Security Management',
                    requiredState: 'Comprehensive ISMS implementation',
                    remediation: 'Implement ISO 27001 security controls'
                }
            ]
        };
        
        return requirements[framework] || [];
    }

    private assessRequirementCompliance(requirement: any, checks: ComplianceCheck[]): { score: number; currentState: string } {
        // Assess compliance based on recent checks
        const relevantChecks = checks.filter(check => 
            check.result.recommendations.some(rec => 
                rec.toLowerCase().includes(requirement.name.toLowerCase().split(' ')[0])
            )
        );
        
        if (relevantChecks.length === 0) {
            return { score: 0.5, currentState: 'No recent compliance data' };
        }
        
        const compliantChecks = relevantChecks.filter(check => check.result.compliant);
        const score = compliantChecks.length / relevantChecks.length;
        
        const currentState = score > 0.8 ? 'Mostly compliant' :
                           score > 0.6 ? 'Partially compliant' :
                           score > 0.3 ? 'Limited compliance' : 'Non-compliant';
        
        return { score, currentState };
    }

    private generateFrameworkRecommendations(framework: ComplianceFramework, _findings: any): any {
        const baseRecommendations = {
            immediate: ['Review critical violations', 'Implement missing safeguards'],
            shortTerm: ['Update compliance policies', 'Train staff on requirements'],
            longTerm: ['Implement automated compliance monitoring', 'Regular compliance audits'],
            regulatory: ['Prepare for regulatory inquiries', 'Document compliance efforts']
        };

        // Framework-specific recommendations
        switch (framework) {
            case 'gdpr':
                baseRecommendations.immediate.push('Verify consent mechanisms', 'Check data retention periods');
                baseRecommendations.regulatory.push('Prepare for DPA inquiries', 'Document lawful basis');
                break;
            case 'hipaa':
                baseRecommendations.immediate.push('Secure PHI transmission', 'Verify access controls');
                baseRecommendations.regulatory.push('Prepare for HHS audits', 'Document security measures');
                break;
            case 'pci_dss':
                baseRecommendations.immediate.push('Secure cardholder data', 'Implement PCI controls');
                baseRecommendations.regulatory.push('Prepare for QSA assessment', 'Document security controls');
                break;
        }

        return baseRecommendations;
    }

    // Storage and utility methods
    private async storeComplianceCheck(check: ComplianceCheck): Promise<void> {
        try {
            const cacheKey = `compliance_check:${check.checkId}`;
            await cacheService.set(cacheKey, check, 2592000); // 30 days
        } catch (error) {
            loggingService.error('Failed to store compliance check', {
                component: 'ComplianceEnforcementService',
                checkId: check.checkId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    private async storeViolation(violation: ComplianceViolation): Promise<void> {
        try {
            const cacheKey = `compliance_violation:${violation.violationId}`;
            await cacheService.set(cacheKey, violation, 2592000 * 12); // 1 year
        } catch (error) {
            loggingService.error('Failed to store compliance violation', {
                component: 'ComplianceEnforcementService',
                violationId: violation.violationId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    private async storeConsentRecord(consent: ConsentRecord): Promise<void> {
        try {
            const cacheKey = `consent:${consent.userId}:${consent.consent.framework}`;
            await cacheService.set(cacheKey, consent, consent.consent.duration * 86400); // Duration in days
        } catch (error) {
            loggingService.error('Failed to store consent record', {
                component: 'ComplianceEnforcementService',
                consentId: consent.consentId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    private async storeComplianceReport(report: ComplianceReport): Promise<void> {
        try {
            const cacheKey = `compliance_report:${report.reportId}`;
            await cacheService.set(cacheKey, report, 2592000 * 12); // 1 year
        } catch (error) {
            loggingService.error('Failed to store compliance report', {
                component: 'ComplianceEnforcementService',
                reportId: report.reportId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    private async sendImmediateAlert(violation: ComplianceViolation, context: any): Promise<void> {
        // This would integrate with alerting system
        loggingService.error('IMMEDIATE COMPLIANCE ALERT', {
            component: 'ComplianceEnforcementService',
            alert_type: 'compliance_violation',
            violationId: violation.violationId,
            framework: violation.framework,
            severity: violation.severity,
            context
        });
    }

    private async escalateToLegal(violation: ComplianceViolation, context: any): Promise<void> {
        // This would integrate with legal team notification system
        loggingService.error('LEGAL ESCALATION REQUIRED', {
            component: 'ComplianceEnforcementService',
            escalation_type: 'compliance_violation',
            violationId: violation.violationId,
            legalRisk: violation.legalRisk,
            potentialFines: violation.potentialFines,
            context
        });
    }

    private async notifySecurityTeam(violation: ComplianceViolation, context: any): Promise<void> {
        // This would integrate with security team notification system
        loggingService.error('SECURITY TEAM NOTIFICATION', {
            component: 'ComplianceEnforcementService',
            notification_type: 'compliance_violation',
            violationId: violation.violationId,
            framework: violation.framework,
            context
        });
    }

    private async performAutoRemediation(violation: ComplianceViolation, rule: ComplianceRule): Promise<void> {
        try {
            // Perform automatic remediation steps
            for (const step of rule.violation.remediationSteps) {
                await this.executeRemediationStep(step, violation);
            }
            
            this.stats.autoRemediations++;
            
            loggingService.info('Auto-remediation completed', {
                component: 'ComplianceEnforcementService',
                violationId: violation.violationId,
                steps: rule.violation.remediationSteps.length
            });
        } catch (error) {
            loggingService.error('Auto-remediation failed', {
                component: 'ComplianceEnforcementService',
                violationId: violation.violationId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    private async executeRemediationStep(step: string, violation: ComplianceViolation): Promise<void> {
        // Execute specific remediation steps
        switch (step.toLowerCase()) {
            case 'stop processing':
                await cacheService.set(`processing_blocked:${violation.violationId}`, true, 3600);
                break;
            case 'delete data':
                // Would integrate with data deletion system
                break;
            case 'notify authorities':
                await this.notifyRegulatoryAuthorities(violation);
                break;
            default:
                loggingService.debug('Unknown remediation step', {
                    component: 'ComplianceEnforcementService',
                    step,
                    violationId: violation.violationId
                });
        }
    }

    private async notifyRegulatoryAuthorities(violation: ComplianceViolation): Promise<void> {
        // This would integrate with regulatory notification system
        loggingService.error('REGULATORY NOTIFICATION REQUIRED', {
            component: 'ComplianceEnforcementService',
            violationId: violation.violationId,
            framework: violation.framework,
            severity: violation.severity,
            potentialFines: violation.potentialFines
        });
    }

    private async handleMajorViolation(violation: ComplianceViolation, context: any): Promise<void> {
        loggingService.warn('Major compliance violation detected', {
            component: 'ComplianceEnforcementService',
            violationId: violation.violationId,
            framework: violation.framework,
            context
        });
    }

    private async handleMinorViolation(violation: ComplianceViolation, context: any): Promise<void> {
        loggingService.info('Minor compliance violation detected', {
            component: 'ComplianceEnforcementService',
            violationId: violation.violationId,
            framework: violation.framework,
            context
        });
    }

    private initializeDefaultRules(): void {
        for (const ruleTemplate of this.defaultRules) {
            const ruleId = this.generateRuleId();
            const rule: ComplianceRule = {
                ...ruleTemplate,
                id: ruleId,
                lastUpdated: Date.now()
            };
            this.complianceRules.set(ruleId, rule);
        }

        loggingService.info('Default compliance rules initialized', {
            component: 'ComplianceEnforcementService',
            ruleCount: this.complianceRules.size
        });
    }

    private startComplianceMonitoring(): void {
        // Start periodic compliance monitoring
        setInterval(async () => {
            try {
                await this.performPeriodicComplianceCheck();
            } catch (error) {
                loggingService.error('Periodic compliance check failed', {
                    component: 'ComplianceEnforcementService',
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }, 3600000); // Every hour
    }

    private async performPeriodicComplianceCheck(): Promise<void> {
        // Check for expired consents, retention violations, etc.
        const now = Date.now();
        
        // Check for expired consents
        for (const consent of this.consentRecords.values()) {
            const expiryTime = consent.timestamp + (consent.consent.duration * 86400 * 1000);
            if (now > expiryTime && !consent.status.expired) {
                consent.status.expired = true;
                consent.status.lastUpdated = now;
                await this.storeConsentRecord(consent);
                
                this.emit('consent_expired', {
                    consentId: consent.consentId,
                    userId: consent.userId,
                    framework: consent.consent.framework
                });
            }
        }
    }

    private updateStatistics(check: ComplianceCheck, processingTime: number): void {
        this.stats.totalChecks++;
        
        if (check.result.violationsFound.length > 0) {
            this.stats.violationsDetected++;
        }
        
        if (check.result.violationsFound.some(v => v.severity === 'critical')) {
            this.stats.criticalViolations++;
        }
        
        if (check.actions.consentRequested) {
            this.stats.consentRequests++;
        }
        
        if (check.context.userConsent) {
            this.stats.consentGranted++;
        }

        // Update average check time
        const totalTime = (this.stats.averageCheckTime * (this.stats.totalChecks - 1)) + processingTime;
        this.stats.averageCheckTime = totalTime / this.stats.totalChecks;
    }

    // ID generation methods
    private generateCheckId(): string {
        return `chk_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    private generateViolationId(): string {
        return `vio_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    private generateConsentId(): string {
        return `con_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    private generateReportId(): string {
        return `rpt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    private generateRuleId(): string {
        return `rule_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    /**
     * Get service statistics
     */
    public getStatistics(): typeof this.stats & { 
        activeRules: number; 
        activeConsents: number; 
        recentViolations: number; 
    } {
        const now = Date.now();
        const recentViolations = this.violationHistory.filter(v => 
            now - v.timestamp < 86400000 // Last 24 hours
        ).length;

        return {
            ...this.stats,
            activeRules: this.complianceRules.size,
            activeConsents: this.consentRecords.size,
            recentViolations
        };
    }

    /**
     * Cleanup resources
     */
    public cleanup(): void {
        this.complianceRules.clear();
        this.violationHistory = [];
        this.consentRecords.clear();
        this.complianceChecks.clear();
        this.removeAllListeners();
    }
}

// Export singleton instance
export const complianceEnforcementService = ComplianceEnforcementService.getInstance();
