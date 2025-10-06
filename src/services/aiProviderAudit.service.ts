import { loggingService } from './logging.service';
import { cacheService } from './cache.service';
import { EventEmitter } from 'events';
import * as crypto from 'crypto';

/**
 * AI Provider Data Audit Service
 * Comprehensive tracking and auditing of all data sent to AI providers
 */

export interface AIProviderRequest {
    requestId: string;
    userId: string;
    provider: 'anthropic' | 'openai' | 'bedrock' | 'custom';
    model: string;
    timestamp: number;
    endpoint: string;
    method: string;
    
    // Data being sent
    requestData: {
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
        redactionDetails?: RedactionDetails;
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

export interface RedactionDetails {
    originalLength: number;
    redactedLength: number;
    patternsRedacted: string[];
    redactionMap: Record<string, string>; // For potential restoration
    redactionTimestamp: number;
}

export interface AIProviderResponse {
    requestId: string;
    responseId: string;
    timestamp: number;
    
    // Response data
    responseData: {
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
        piiInResponse: string[];
        sensitiveContent: string[];
        riskLevel: 'low' | 'medium' | 'high' | 'critical';
        contentModeration: {
            flagged: boolean;
            categories: string[];
            severity: number;
        };
    };
    
    // Performance metrics
    performance: {
        responseTime: number;
        processingTime: number;
        queueTime: number;
        totalCost: number;
    };
}

export interface AuditQuery {
    userId?: string;
    provider?: string;
    timeRange?: {
        start: number;
        end: number;
    };
    riskLevel?: string[];
    complianceFlags?: string[];
    piiTypes?: string[];
    status?: string[];
    limit?: number;
    offset?: number;
}

export interface ComplianceReport {
    reportId: string;
    generatedAt: number;
    timeRange: {
        start: number;
        end: number;
    };
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
        violationType: string;
        severity: string;
        description: string;
        timestamp: number;
    }>;
    recommendations: string[];
}

export class AIProviderAuditService extends EventEmitter {
    private static instance: AIProviderAuditService;
    
    // In-memory cache for recent requests (for performance)
    private recentRequests = new Map<string, AIProviderRequest>();
    private recentResponses = new Map<string, AIProviderResponse>();
    private readonly MAX_CACHE_SIZE = 10000;
    
    // Statistics
    private stats = {
        totalRequests: 0,
        blockedRequests: 0,
        piiDetections: 0,
        complianceViolations: 0,
        highRiskRequests: 0,
        uptime: Date.now()
    };
    
    // PII detection patterns
    private piiPatterns = {
        email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
        ssn: /\b\d{3}-?\d{2}-?\d{4}\b/g,
        creditCard: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g,
        phone: /\b\d{3}[-.()]?\d{3}[-.]\d{4}\b/g,
        ipAddress: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
        apiKey: /\b[A-Za-z0-9]{20,}\b/g,
        jwt: /eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/g,
        uuid: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
        address: /\b\d+\s+[A-Za-z0-9\s,.-]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Place|Pl)\b/gi
    };
    
    // Sensitive data patterns
    private sensitivePatterns = {
        password: /\b(?:password|passwd|pwd)\s*[:=]\s*\S+/gi,
        secret: /\b(?:secret|key|token)\s*[:=]\s*\S+/gi,
        confidential: /\b(?:confidential|private|internal|restricted)\b/gi,
        medical: /\b(?:diagnosis|medication|treatment|patient|medical|health)\b/gi,
        financial: /\b(?:salary|income|revenue|profit|loss|financial|banking|account)\b/gi
    };

    private constructor() {
        super();
        this.startCleanupInterval();
    }

    public static getInstance(): AIProviderAuditService {
        if (!AIProviderAuditService.instance) {
            AIProviderAuditService.instance = new AIProviderAuditService();
        }
        return AIProviderAuditService.instance;
    }

    /**
     * Audit outgoing request to AI provider
     */
    public async auditRequest(
        provider: AIProviderRequest['provider'],
        model: string,
        requestData: AIProviderRequest['requestData'],
        metadata: Partial<AIProviderRequest['metadata']>,
        userId: string,
        endpoint: string,
        method: string = 'POST'
    ): Promise<{
        requestId: string;
        allowed: boolean;
        riskLevel: string;
        blockedReason?: string;
        redactionApplied: boolean;
        auditRecord: AIProviderRequest;
    }> {
        const requestId = this.generateRequestId();
        const timestamp = Date.now();

        try {
            // Analyze the request data for PII and sensitive content
            const securityAnalysis = await this.analyzeRequestSecurity(requestData);
            
            // Determine compliance requirements
            const complianceAnalysis = await this.analyzeCompliance(requestData, metadata, userId);
            
            // Create comprehensive audit record
            const auditRecord: AIProviderRequest = {
                requestId,
                userId,
                provider,
                model,
                timestamp,
                endpoint,
                method,
                requestData: { ...requestData },
                metadata: {
                    userTier: 'standard',
                    sessionId: '',
                    ipAddress: '',
                    userAgent: '',
                    contentLength: JSON.stringify(requestData).length,
                    estimatedTokens: this.estimateTokens(requestData),
                    estimatedCost: 0,
                    ...metadata
                },
                security: securityAnalysis,
                transmission: {
                    status: 'pending'
                },
                compliance: complianceAnalysis
            };

            // Determine if request should be allowed
            const { allowed, blockedReason } = this.determineRequestAllowance(auditRecord);
            
            // Update transmission status
            auditRecord.transmission.status = allowed ? 'pending' : 'blocked';
            if (blockedReason) {
                auditRecord.transmission.blockedReason = blockedReason;
            }

            // Store audit record
            await this.storeAuditRecord(auditRecord);
            
            // Cache for quick access
            this.recentRequests.set(requestId, auditRecord);
            this.cleanupCache();

            // Update statistics
            this.stats.totalRequests++;
            if (!allowed) this.stats.blockedRequests++;
            if (securityAnalysis.piiDetected.length > 0) this.stats.piiDetections++;
            if (securityAnalysis.riskLevel === 'high' || securityAnalysis.riskLevel === 'critical') {
                this.stats.highRiskRequests++;
            }
            if (securityAnalysis.complianceFlags.length > 0) this.stats.complianceViolations++;

            // Emit audit event
            this.emit('request_audited', {
                requestId,
                provider,
                allowed,
                riskLevel: securityAnalysis.riskLevel,
                piiDetected: securityAnalysis.piiDetected.length > 0,
                complianceFlags: securityAnalysis.complianceFlags
            });

            // Log security events
            if (!allowed || securityAnalysis.riskLevel === 'critical') {
                loggingService.error('AI Provider Request Blocked or Critical Risk', {
                    component: 'AIProviderAuditService',
                    requestId,
                    provider,
                    riskLevel: securityAnalysis.riskLevel,
                    blockedReason,
                    piiDetected: securityAnalysis.piiDetected,
                    complianceFlags: securityAnalysis.complianceFlags
                });
            } else if (securityAnalysis.riskLevel === 'high') {
                loggingService.warn('High Risk AI Provider Request', {
                    component: 'AIProviderAuditService',
                    requestId,
                    provider,
                    riskLevel: securityAnalysis.riskLevel,
                    piiDetected: securityAnalysis.piiDetected
                });
            }

            return {
                requestId,
                allowed,
                riskLevel: securityAnalysis.riskLevel,
                blockedReason,
                redactionApplied: securityAnalysis.redactionApplied,
                auditRecord
            };

        } catch (error) {
            loggingService.error('AI Provider Audit Request Failed', {
                component: 'AIProviderAuditService',
                requestId,
                provider,
                error: error instanceof Error ? error.message : String(error)
            });

            // Return safe defaults on error
            return {
                requestId,
                allowed: false,
                riskLevel: 'critical',
                blockedReason: 'Audit system error - request blocked for security',
                redactionApplied: false,
                auditRecord: {} as AIProviderRequest
            };
        }
    }

    /**
     * Audit response from AI provider
     */
    public async auditResponse(
        requestId: string,
        responseData: AIProviderResponse['responseData'],
        performance: AIProviderResponse['performance']
    ): Promise<void> {
        try {
            const responseId = this.generateResponseId();
            const timestamp = Date.now();

            // Analyze response for security issues
            const securityAnalysis = await this.analyzeResponseSecurity(responseData);

            // Create response audit record
            const auditRecord: AIProviderResponse = {
                requestId,
                responseId,
                timestamp,
                responseData,
                security: securityAnalysis,
                performance
            };

            // Store response audit record
            await this.storeResponseAuditRecord(auditRecord);
            
            // Cache for quick access
            this.recentResponses.set(responseId, auditRecord);

            // Update request record with response info
            const requestRecord = this.recentRequests.get(requestId);
            if (requestRecord) {
                requestRecord.transmission.status = 'sent';
                requestRecord.transmission.responseReceived = timestamp;
                requestRecord.transmission.responseSize = JSON.stringify(responseData).length;
                await this.updateAuditRecord(requestRecord);
            }

            // Emit response audit event
            this.emit('response_audited', {
                requestId,
                responseId,
                riskLevel: securityAnalysis.riskLevel,
                piiInResponse: securityAnalysis.piiInResponse.length > 0,
                contentFlagged: securityAnalysis.contentModeration.flagged
            });

            // Log high-risk responses
            if (securityAnalysis.riskLevel === 'high' || securityAnalysis.riskLevel === 'critical') {
                loggingService.warn('High Risk AI Provider Response', {
                    component: 'AIProviderAuditService',
                    requestId,
                    responseId,
                    riskLevel: securityAnalysis.riskLevel,
                    piiInResponse: securityAnalysis.piiInResponse,
                    contentFlagged: securityAnalysis.contentModeration.flagged
                });
            }

        } catch (error) {
            loggingService.error('AI Provider Audit Response Failed', {
                component: 'AIProviderAuditService',
                requestId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Analyze request for security issues
     */
    private async analyzeRequestSecurity(requestData: AIProviderRequest['requestData']): Promise<AIProviderRequest['security']> {
        const piiDetected: string[] = [];
        const sensitivePatterns: string[] = [];
        const complianceFlags: string[] = [];
        const dataClassification: string[] = [];
        
        // Combine all text content for analysis
        const textContent = [
            requestData.prompt || '',
            requestData.systemPrompt || '',
            requestData.context || '',
            JSON.stringify(requestData.messages || []),
            JSON.stringify(requestData.attachments || []),
            JSON.stringify(requestData.parameters || {})
        ].join(' ');

        // Detect PII
        for (const [type, pattern] of Object.entries(this.piiPatterns)) {
            if (pattern.test(textContent)) {
                piiDetected.push(type);
                complianceFlags.push(`pii_${type}_detected`);
                dataClassification.push('personal_data');
            }
        }

        // Detect sensitive patterns
        for (const [type, pattern] of Object.entries(this.sensitivePatterns)) {
            if (pattern.test(textContent)) {
                sensitivePatterns.push(type);
                dataClassification.push(`sensitive_${type}`);
            }
        }

        // Determine risk level
        let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
        
        if (piiDetected.length > 3 || sensitivePatterns.includes('medical') || sensitivePatterns.includes('financial')) {
            riskLevel = 'critical';
        } else if (piiDetected.length > 1 || sensitivePatterns.length > 2) {
            riskLevel = 'high';
        } else if (piiDetected.length > 0 || sensitivePatterns.length > 0) {
            riskLevel = 'medium';
        }

        // Apply redaction if needed
        const redactionApplied = riskLevel === 'critical' || piiDetected.length > 2;
        let redactionDetails: RedactionDetails | undefined;
        
        if (redactionApplied) {
            redactionDetails = await this.applyRedaction(requestData, piiDetected);
        }

        // Additional compliance flags
        if (sensitivePatterns.includes('medical')) {
            complianceFlags.push('hipaa_applicable');
        }
        if (piiDetected.length > 0) {
            complianceFlags.push('gdpr_applicable');
        }
        if (dataClassification.length > 0) {
            complianceFlags.push('soc2_applicable');
        }

        return {
            piiDetected,
            sensitivePatterns,
            riskLevel,
            complianceFlags,
            dataClassification,
            redactionApplied,
            redactionDetails
        };
    }

    /**
     * Analyze response for security issues
     */
    private async analyzeResponseSecurity(responseData: AIProviderResponse['responseData']): Promise<AIProviderResponse['security']> {
        const piiInResponse: string[] = [];
        const sensitiveContent: string[] = [];
        
        const content = responseData.content || '';
        
        // Check for PII in response
        for (const [type, pattern] of Object.entries(this.piiPatterns)) {
            if (pattern.test(content)) {
                piiInResponse.push(type);
            }
        }

        // Check for sensitive content
        for (const [type, pattern] of Object.entries(this.sensitivePatterns)) {
            if (pattern.test(content)) {
                sensitiveContent.push(type);
            }
        }

        // Content moderation
        const contentModeration = await this.performContentModeration(content);

        // Determine risk level
        let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
        
        if (contentModeration.flagged && contentModeration.severity > 0.8) {
            riskLevel = 'critical';
        } else if (piiInResponse.length > 2 || contentModeration.flagged) {
            riskLevel = 'high';
        } else if (piiInResponse.length > 0 || sensitiveContent.length > 0) {
            riskLevel = 'medium';
        }

        return {
            piiInResponse,
            sensitiveContent,
            riskLevel,
            contentModeration
        };
    }

    /**
     * Analyze compliance requirements
     */
    private async analyzeCompliance(
        requestData: AIProviderRequest['requestData'],
        metadata: Partial<AIProviderRequest['metadata']>,
        userId: string
    ): Promise<AIProviderRequest['compliance']> {
        // This would integrate with user consent management system
        const userConsent = await this.getUserConsent(userId);
        
        return {
            gdprApplicable: this.isGDPRApplicable(metadata),
            hipaaApplicable: this.isHIPAAApplicable(requestData),
            soc2Applicable: true, // Always applicable for our service
            consentObtained: userConsent.obtained,
            legalBasis: userConsent.legalBasis,
            dataRetentionPolicy: 'retain_30_days',
            geographicRestrictions: this.getGeographicRestrictions(metadata)
        };
    }

    /**
     * Determine if request should be allowed
     */
    private determineRequestAllowance(auditRecord: AIProviderRequest): { allowed: boolean; blockedReason?: string } {
        // Block critical risk requests
        if (auditRecord.security.riskLevel === 'critical') {
            return {
                allowed: false,
                blockedReason: 'Critical security risk detected - PII and sensitive data protection'
            };
        }

        // Block if required consent not obtained
        if ((auditRecord.compliance.gdprApplicable || auditRecord.compliance.hipaaApplicable) && 
            !auditRecord.compliance.consentObtained) {
            return {
                allowed: false,
                blockedReason: 'Required user consent not obtained for data processing'
            };
        }

        // Block if geographic restrictions apply
        if (auditRecord.compliance.geographicRestrictions.includes('blocked')) {
            return {
                allowed: false,
                blockedReason: 'Geographic restrictions prevent data transmission'
            };
        }

        // Block high-risk requests without proper safeguards
        if (auditRecord.security.riskLevel === 'high' && !auditRecord.security.redactionApplied) {
            return {
                allowed: false,
                blockedReason: 'High-risk request requires data redaction before transmission'
            };
        }

        return { allowed: true };
    }

    /**
     * Apply redaction to request data
     */
    private async applyRedaction(
        requestData: AIProviderRequest['requestData'],
        piiTypes: string[]
    ): Promise<RedactionDetails> {
        const originalLength = JSON.stringify(requestData).length;
        const redactionMap: Record<string, string> = {};
        const patternsRedacted: string[] = [];

        // Apply redaction to each text field
        for (const field of ['prompt', 'systemPrompt', 'context'] as const) {
            if (requestData[field]) {
                const { redacted, map } = this.redactText(requestData[field]!, piiTypes);
                requestData[field] = redacted;
                Object.assign(redactionMap, map);
                patternsRedacted.push(...Object.keys(map));
            }
        }

        // Redact messages array
        if (requestData.messages && Array.isArray(requestData.messages)) {
            for (const message of requestData.messages) {
                if (message.content) {
                    const { redacted, map } = this.redactText(message.content, piiTypes);
                    message.content = redacted;
                    Object.assign(redactionMap, map);
                    patternsRedacted.push(...Object.keys(map));
                }
            }
        }

        const redactedLength = JSON.stringify(requestData).length;

        return {
            originalLength,
            redactedLength,
            patternsRedacted: [...new Set(patternsRedacted)],
            redactionMap,
            redactionTimestamp: Date.now()
        };
    }

    /**
     * Redact text content
     */
    private redactText(text: string, piiTypes: string[]): { redacted: string; map: Record<string, string> } {
        let redacted = text;
        const map: Record<string, string> = {};

        for (const piiType of piiTypes) {
            const pattern = this.piiPatterns[piiType as keyof typeof this.piiPatterns];
            if (pattern) {
                const matches = text.match(pattern);
                if (matches) {
                    for (const match of matches) {
                        const placeholder = `[REDACTED_${piiType.toUpperCase()}_${this.generateShortId()}]`;
                        redacted = redacted.replace(match, placeholder);
                        map[placeholder] = match;
                    }
                }
            }
        }

        return { redacted, map };
    }

    /**
     * Perform content moderation
     */
    private async performContentModeration(content: string): Promise<{
        flagged: boolean;
        categories: string[];
        severity: number;
    }> {
        // This would integrate with content moderation service
        // For now, basic pattern matching
        const flaggedCategories: string[] = [];
        let severity = 0;

        const harmfulPatterns = {
            violence: /\b(?:kill|murder|violence|harm|hurt|attack)\b/gi,
            hate: /\b(?:hate|racist|discriminat|bigot)\b/gi,
            adult: /\b(?:sexual|explicit|adult|nsfw)\b/gi,
            illegal: /\b(?:illegal|drugs|weapon|bomb)\b/gi
        };

        for (const [category, pattern] of Object.entries(harmfulPatterns)) {
            if (pattern.test(content)) {
                flaggedCategories.push(category);
                severity = Math.max(severity, 0.7);
            }
        }

        return {
            flagged: flaggedCategories.length > 0,
            categories: flaggedCategories,
            severity
        };
    }

    /**
     * Store audit record in persistent storage
     */
    private async storeAuditRecord(record: AIProviderRequest): Promise<void> {
        try {
            // Store in cache with TTL
            const cacheKey = `ai_audit_request:${record.requestId}`;
            await cacheService.set(cacheKey, record, 2592000); // 30 days

            // Store in database (would integrate with actual DB)
            // await AuditRequestModel.create(record);

        } catch (error) {
            loggingService.error('Failed to store AI audit record', {
                component: 'AIProviderAuditService',
                requestId: record.requestId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Store response audit record
     */
    private async storeResponseAuditRecord(record: AIProviderResponse): Promise<void> {
        try {
            const cacheKey = `ai_audit_response:${record.responseId}`;
            await cacheService.set(cacheKey, record, 2592000); // 30 days
        } catch (error) {
            loggingService.error('Failed to store AI response audit record', {
                component: 'AIProviderAuditService',
                responseId: record.responseId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Update existing audit record
     */
    private async updateAuditRecord(record: AIProviderRequest): Promise<void> {
        try {
            const cacheKey = `ai_audit_request:${record.requestId}`;
            await cacheService.set(cacheKey, record, 2592000);
        } catch (error) {
            loggingService.error('Failed to update AI audit record', {
                component: 'AIProviderAuditService',
                requestId: record.requestId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Query audit records
     */
    public async queryAuditRecords(query: AuditQuery): Promise<{
        records: AIProviderRequest[];
        total: number;
        hasMore: boolean;
    }> {
        try {
            // This would query the database
            // For now, return from cache
            const allRecords = Array.from(this.recentRequests.values());
            
            let filteredRecords = allRecords;
            
            // Apply filters
            if (query.userId) {
                filteredRecords = filteredRecords.filter(r => r.userId === query.userId);
            }
            
            if (query.provider) {
                filteredRecords = filteredRecords.filter(r => r.provider === query.provider);
            }
            
            if (query.timeRange) {
                filteredRecords = filteredRecords.filter(r => 
                    r.timestamp >= query.timeRange!.start && r.timestamp <= query.timeRange!.end
                );
            }
            
            if (query.riskLevel) {
                filteredRecords = filteredRecords.filter(r => 
                    query.riskLevel!.includes(r.security.riskLevel)
                );
            }
            
            // Apply pagination
            const offset = query.offset || 0;
            const limit = query.limit || 100;
            const paginatedRecords = filteredRecords.slice(offset, offset + limit);
            
            return {
                records: paginatedRecords,
                total: filteredRecords.length,
                hasMore: offset + limit < filteredRecords.length
            };
            
        } catch (error) {
            loggingService.error('Failed to query audit records', {
                component: 'AIProviderAuditService',
                error: error instanceof Error ? error.message : String(error)
            });
            return { records: [], total: 0, hasMore: false };
        }
    }

    /**
     * Generate compliance report
     */
    public async generateComplianceReport(timeRange: { start: number; end: number }): Promise<ComplianceReport> {
        const reportId = this.generateReportId();
        const generatedAt = Date.now();
        
        try {
            const { records } = await this.queryAuditRecords({ timeRange, limit: 10000 });
            
            const summary = {
                totalRequests: records.length,
                piiRequestsCount: records.filter(r => r.security.piiDetected.length > 0).length,
                highRiskRequests: records.filter(r => r.security.riskLevel === 'high' || r.security.riskLevel === 'critical').length,
                blockedRequests: records.filter(r => r.transmission.status === 'blocked').length,
                complianceViolations: records.filter(r => r.security.complianceFlags.length > 0).length
            };
            
            const breakdown = {
                byProvider: this.groupBy(records, r => r.provider),
                byRiskLevel: this.groupBy(records, r => r.security.riskLevel),
                byPiiType: this.groupByArray(records, r => r.security.piiDetected),
                byComplianceFlag: this.groupByArray(records, r => r.security.complianceFlags)
            };
            
            const violations = records
                .filter(r => r.security.complianceFlags.length > 0)
                .map(r => ({
                    requestId: r.requestId,
                    violationType: r.security.complianceFlags[0],
                    severity: r.security.riskLevel,
                    description: `${r.security.complianceFlags.join(', ')} detected in request to ${r.provider}`,
                    timestamp: r.timestamp
                }));
            
            const recommendations = this.generateRecommendations(summary, breakdown);
            
            return {
                reportId,
                generatedAt,
                timeRange,
                summary,
                breakdown,
                violations,
                recommendations
            };
            
        } catch (error) {
            loggingService.error('Failed to generate compliance report', {
                component: 'AIProviderAuditService',
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    // Helper methods
    private generateRequestId(): string {
        return `req_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    }

    private generateResponseId(): string {
        return `res_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    }

    private generateReportId(): string {
        return `rpt_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    }

    private generateShortId(): string {
        return crypto.randomBytes(4).toString('hex');
    }

    private estimateTokens(requestData: AIProviderRequest['requestData']): number {
        const text = JSON.stringify(requestData);
        return Math.ceil(text.length / 4); // Rough estimation
    }

    private async getUserConsent(userId: string): Promise<{ obtained: boolean; legalBasis: string }> {
        // This would integrate with consent management system
        return { obtained: true, legalBasis: 'legitimate_interest' };
    }

    private isGDPRApplicable(metadata: Partial<AIProviderRequest['metadata']>): boolean {
        // Check if user is in EU or data relates to EU residents
        return true; // Conservative approach
    }

    private isHIPAAApplicable(requestData: AIProviderRequest['requestData']): boolean {
        const text = JSON.stringify(requestData).toLowerCase();
        return /\b(?:medical|health|patient|diagnosis|treatment|medication)\b/.test(text);
    }

    private getGeographicRestrictions(metadata: Partial<AIProviderRequest['metadata']>): string[] {
        // Check geographic restrictions based on IP, etc.
        return [];
    }

    private groupBy<T>(array: T[], keyFn: (item: T) => string): Record<string, number> {
        return array.reduce((acc, item) => {
            const key = keyFn(item);
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
    }

    private groupByArray<T>(array: T[], keyFn: (item: T) => string[]): Record<string, number> {
        return array.reduce((acc, item) => {
            const keys = keyFn(item);
            for (const key of keys) {
                acc[key] = (acc[key] || 0) + 1;
            }
            return acc;
        }, {} as Record<string, number>);
    }

    private generateRecommendations(summary: any, breakdown: any): string[] {
        const recommendations: string[] = [];
        
        if (summary.piiRequestsCount > summary.totalRequests * 0.1) {
            recommendations.push('High PII detection rate - consider implementing stricter pre-transmission filtering');
        }
        
        if (summary.highRiskRequests > summary.totalRequests * 0.05) {
            recommendations.push('Elevated high-risk requests - review data classification and handling procedures');
        }
        
        if (summary.complianceViolations > 0) {
            recommendations.push('Compliance violations detected - review consent management and data processing procedures');
        }
        
        return recommendations;
    }

    private cleanupCache(): void {
        if (this.recentRequests.size > this.MAX_CACHE_SIZE) {
            const entries = Array.from(this.recentRequests.entries());
            entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
            
            // Remove oldest 20%
            const toRemove = Math.floor(this.MAX_CACHE_SIZE * 0.2);
            for (let i = 0; i < toRemove; i++) {
                this.recentRequests.delete(entries[i][0]);
            }
        }
        
        if (this.recentResponses.size > this.MAX_CACHE_SIZE) {
            const entries = Array.from(this.recentResponses.entries());
            entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
            
            const toRemove = Math.floor(this.MAX_CACHE_SIZE * 0.2);
            for (let i = 0; i < toRemove; i++) {
                this.recentResponses.delete(entries[i][0]);
            }
        }
    }

    private startCleanupInterval(): void {
        setInterval(() => {
            this.cleanupCache();
        }, 300000); // Every 5 minutes
    }

    /**
     * Get service statistics
     */
    public getStatistics(): typeof this.stats & { cacheSize: number } {
        return {
            ...this.stats,
            cacheSize: this.recentRequests.size + this.recentResponses.size
        };
    }

    /**
     * Cleanup resources
     */
    public cleanup(): void {
        this.recentRequests.clear();
        this.recentResponses.clear();
        this.removeAllListeners();
    }
}

// Export singleton instance
export const aiProviderAuditService = AIProviderAuditService.getInstance();
