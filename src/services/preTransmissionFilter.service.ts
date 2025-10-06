import { loggingService } from './logging.service';
import { cacheService } from './cache.service';
import { EventEmitter } from 'events';
import * as crypto from 'crypto';

/**
 * Pre-Transmission PII Filter Service
 * Prevents sensitive data from reaching external AI services
 */

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

export interface FilterConfig {
    enablePreTransmissionFiltering: boolean;
    defaultAction: 'log' | 'redact' | 'block';
    riskThreshold: number; // 0-1, above which requests are blocked
    enableMachineLearning: boolean;
    enableContextualAnalysis: boolean;
    enableRealTimeUpdates: boolean;
    retainOriginalData: boolean;
    auditAllFiltering: boolean;
    customRulesEnabled: boolean;
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

export class PreTransmissionFilterService extends EventEmitter {
    private static instance: PreTransmissionFilterService;
    
    private filterRules: Map<string, FilterRule> = new Map();
    private filterStats!: FilterStatistics;
    private detectionCache = new Map<string, FilterResult>();
    private readonly MAX_CACHE_SIZE = 10000;
    
    // Configuration
    private config: FilterConfig = {
        enablePreTransmissionFiltering: true,
        defaultAction: 'redact',
        riskThreshold: 0.7,
        enableMachineLearning: false, // Would be enabled with proper ML integration
        enableContextualAnalysis: true,
        enableRealTimeUpdates: true,
        retainOriginalData: true,
        auditAllFiltering: true,
        customRulesEnabled: true
    };

    // Default filter rules
    private defaultRules: Omit<FilterRule, 'id' | 'createdAt' | 'updatedAt'>[] = [
        {
            name: 'Email Addresses',
            description: 'Detect and redact email addresses',
            pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
            category: 'pii',
            severity: 'high',
            action: 'redact',
            replacement: '[EMAIL_REDACTED]',
            enabled: true
        },
        {
            name: 'Social Security Numbers',
            description: 'Detect and block SSNs',
            pattern: /\b\d{3}-?\d{2}-?\d{4}\b/g,
            category: 'pii',
            severity: 'critical',
            action: 'block',
            enabled: true
        },
        {
            name: 'Credit Card Numbers',
            description: 'Detect and block credit card numbers',
            pattern: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g,
            category: 'pii',
            severity: 'critical',
            action: 'block',
            enabled: true
        },
        {
            name: 'Phone Numbers',
            description: 'Detect and redact phone numbers',
            pattern: /\b\d{3}[-.()]?\d{3}[-.]\d{4}\b/g,
            category: 'pii',
            severity: 'medium',
            action: 'redact',
            replacement: '[PHONE_REDACTED]',
            enabled: true
        },
        {
            name: 'API Keys',
            description: 'Detect and block API keys',
            pattern: /\b[A-Za-z0-9]{20,}\b/g,
            category: 'sensitive',
            severity: 'critical',
            action: 'block',
            enabled: true
        },
        {
            name: 'JWT Tokens',
            description: 'Detect and block JWT tokens',
            pattern: /eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/g,
            category: 'sensitive',
            severity: 'critical',
            action: 'block',
            enabled: true
        },
        {
            name: 'IP Addresses',
            description: 'Detect and redact IP addresses',
            pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
            category: 'pii',
            severity: 'medium',
            action: 'redact',
            replacement: '[IP_REDACTED]',
            enabled: true
        },
        {
            name: 'UUIDs',
            description: 'Detect and redact UUIDs',
            pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
            category: 'sensitive',
            severity: 'medium',
            action: 'redact',
            replacement: '[UUID_REDACTED]',
            enabled: true
        },
        {
            name: 'Passwords',
            description: 'Detect and block password fields',
            pattern: /\b(?:password|passwd|pwd)\s*[:=]\s*\S+/gi,
            category: 'confidential',
            severity: 'critical',
            action: 'block',
            enabled: true
        },
        {
            name: 'Secrets and Keys',
            description: 'Detect and block secret keys',
            pattern: /\b(?:secret|key|token)\s*[:=]\s*\S+/gi,
            category: 'confidential',
            severity: 'critical',
            action: 'block',
            enabled: true
        },
        {
            name: 'Medical Information',
            description: 'Detect medical information requiring HIPAA protection',
            pattern: /\b(?:patient|diagnosis|medication|treatment|medical record|health condition)\b/gi,
            category: 'compliance',
            severity: 'high',
            action: 'alert',
            enabled: true
        },
        {
            name: 'Financial Information',
            description: 'Detect financial information',
            pattern: /\b(?:account number|routing number|bank account|credit score|salary|income)\b/gi,
            category: 'compliance',
            severity: 'high',
            action: 'redact',
            replacement: '[FINANCIAL_INFO_REDACTED]',
            enabled: true
        }
    ];

    private constructor() {
        super();
        this.initializeDefaultRules();
        this.initializeStats();
    }

    public static getInstance(): PreTransmissionFilterService {
        if (!PreTransmissionFilterService.instance) {
            PreTransmissionFilterService.instance = new PreTransmissionFilterService();
        }
        return PreTransmissionFilterService.instance;
    }

    /**
     * Filter text content before transmission to AI providers
     */
    public async filterContent(
        content: string,
        context: {
            userId: string;
            provider: string;
            model: string;
            endpoint: string;
            userTier?: string;
        }
    ): Promise<FilterResult> {
        const startTime = Date.now();
        
        if (!this.config.enablePreTransmissionFiltering) {
            return {
                allowed: true,
                modified: false,
                originalText: content,
                filteredText: content,
                detections: [],
                riskScore: 0,
                timestamp: Date.now(),
                metadata: {
                    processingTime: Date.now() - startTime,
                    rulesApplied: [],
                    redactionCount: 0,
                    blockingRules: []
                }
            };
        }

        try {
            // Check cache first
            const cacheKey = this.generateCacheKey(content, context);
            const cached = this.detectionCache.get(cacheKey);
            if (cached) {
                return cached;
            }

            let filteredText = content;
            const detections: Detection[] = [];
            const rulesApplied: string[] = [];
            const blockingRules: string[] = [];
            let redactionCount = 0;
            let blocked = false;
            let blockReason = '';

            // Apply all enabled filter rules
            for (const rule of this.filterRules.values()) {
                if (!rule.enabled) continue;

                const ruleDetections = this.applyFilterRule(filteredText, rule, context);
                
                if (ruleDetections.matches.length > 0) {
                    detections.push(ruleDetections);
                    rulesApplied.push(rule.id);

                    // Apply the rule action
                    switch (rule.action) {
                        case 'block':
                            blocked = true;
                            blockReason = `Blocked due to ${rule.name}: ${ruleDetections.matches.length} matches`;
                            blockingRules.push(rule.id);
                            break;

                        case 'redact':
                            filteredText = this.applyRedaction(filteredText, rule, ruleDetections.matches);
                            redactionCount += ruleDetections.matches.length;
                            break;

                        case 'alert':
                            await this.sendSecurityAlert(rule, ruleDetections, context);
                            break;

                        case 'log':
                            loggingService.info('PII Filter Detection', {
                                component: 'PreTransmissionFilterService',
                                rule: rule.name,
                                matches: ruleDetections.matches.length,
                                context
                            });
                            break;
                    }
                }
            }

            // Calculate risk score
            const riskScore = this.calculateRiskScore(detections);

            // Additional blocking based on risk threshold
            if (riskScore > this.config.riskThreshold && !blocked) {
                blocked = true;
                blockReason = `Risk score ${riskScore.toFixed(2)} exceeds threshold ${this.config.riskThreshold}`;
            }

            const result: FilterResult = {
                allowed: !blocked,
                modified: filteredText !== content,
                originalText: content,
                filteredText,
                detections,
                riskScore,
                blockedReason: blocked ? blockReason : undefined,
                timestamp: Date.now(),
                metadata: {
                    processingTime: Date.now() - startTime,
                    rulesApplied,
                    redactionCount,
                    blockingRules
                }
            };

            // Cache the result
            this.detectionCache.set(cacheKey, result);
            this.cleanupCache();

            // Update statistics
            this.updateStatistics(result);

            // Emit filtering event
            this.emit('content_filtered', {
                allowed: result.allowed,
                modified: result.modified,
                riskScore: result.riskScore,
                detections: result.detections.length,
                context
            });

            // Log significant filtering events
            if (blocked || riskScore > 0.5) {
                loggingService.warn('Pre-transmission filtering applied', {
                    component: 'PreTransmissionFilterService',
                    allowed: result.allowed,
                    riskScore: result.riskScore,
                    detections: result.detections.length,
                    redactionCount,
                    blockReason,
                    context
                });
            }

            return result;

        } catch (error) {
            loggingService.error('Pre-transmission filtering failed', {
                component: 'PreTransmissionFilterService',
                error: error instanceof Error ? error.message : String(error),
                context
            });

            // Return blocked result on error (fail-safe)
            return {
                allowed: false,
                modified: false,
                originalText: content,
                filteredText: content,
                detections: [],
                riskScore: 1.0,
                blockedReason: 'Filtering system error - blocked for security',
                timestamp: Date.now(),
                metadata: {
                    processingTime: Date.now() - startTime,
                    rulesApplied: [],
                    redactionCount: 0,
                    blockingRules: []
                }
            };
        }
    }

    /**
     * Apply a single filter rule to content
     */
    private applyFilterRule(
        content: string,
        rule: FilterRule,
        _context: any
    ): Detection {
        const matches: Detection['matches'] = [];
        let match;

        // Reset regex lastIndex for global patterns
        rule.pattern.lastIndex = 0;

        while ((match = rule.pattern.exec(content)) !== null) {
            const matchText = match[0];
            const position = match.index;
            const contextStart = Math.max(0, position - 20);
            const contextEnd = Math.min(content.length, position + matchText.length + 20);
            const contextText = content.substring(contextStart, contextEnd);

            matches.push({
                text: matchText,
                position,
                length: matchText.length,
                context: contextText
            });

            // Prevent infinite loops with global regex
            if (!rule.pattern.global) break;
        }

        return {
            ruleId: rule.id,
            ruleName: rule.name,
            category: rule.category,
            severity: rule.severity,
            pattern: rule.pattern.source,
            matches,
            action: rule.action,
            applied: matches.length > 0
        };
    }

    /**
     * Apply redaction to content
     */
    private applyRedaction(content: string, rule: FilterRule, matches: Detection['matches']): string {
        let redacted = content;
        
        // Sort matches by position in reverse order to maintain positions during replacement
        const sortedMatches = matches.sort((a, b) => b.position - a.position);
        
        for (const match of sortedMatches) {
            const replacement = rule.replacement || `[${rule.category.toUpperCase()}_REDACTED]`;
            redacted = redacted.substring(0, match.position) + 
                      replacement + 
                      redacted.substring(match.position + match.length);
        }
        
        return redacted;
    }

    /**
     * Calculate risk score based on detections
     */
    private calculateRiskScore(detections: Detection[]): number {
        if (detections.length === 0) return 0;

        const severityWeights = {
            low: 0.1,
            medium: 0.3,
            high: 0.6,
            critical: 1.0
        };

        const categoryWeights = {
            pii: 1.0,
            sensitive: 0.8,
            confidential: 0.9,
            compliance: 0.7
        };

        let totalScore = 0;
        let maxScore = 0;

        for (const detection of detections) {
            const severityWeight = severityWeights[detection.severity as keyof typeof severityWeights];
            const categoryWeight = categoryWeights[detection.category as keyof typeof categoryWeights];
            const matchCount = detection.matches.length;
            
            const detectionScore = severityWeight * categoryWeight * Math.min(matchCount / 5, 1); // Cap at 5 matches
            totalScore += detectionScore;
            maxScore += severityWeight * categoryWeight;
        }

        // Normalize to 0-1 range
        return maxScore > 0 ? Math.min(totalScore / maxScore, 1) : 0;
    }

    /**
     * Send security alert for high-risk detections
     */
    private async sendSecurityAlert(rule: FilterRule, detection: Detection, context: any): Promise<void> {
        try {
            const alert = {
                alertId: this.generateAlertId(),
                timestamp: Date.now(),
                rule: {
                    id: rule.id,
                    name: rule.name,
                    severity: rule.severity
                },
                detection: {
                    category: detection.category,
                    matchCount: detection.matches.length,
                    samples: detection.matches.slice(0, 3).map(m => ({
                        text: m.text.substring(0, 10) + '...',
                        context: m.context
                    }))
                },
                context,
                acknowledged: false
            };

            // Store alert
            await cacheService.set(`security_alert:${alert.alertId}`, alert, 2592000); // 30 days

            // Emit alert event
            this.emit('security_alert', alert);

            loggingService.error('SECURITY ALERT: PII/Sensitive Data Detected', {
                component: 'PreTransmissionFilterService',
                alertId: alert.alertId,
                rule: rule.name,
                severity: rule.severity,
                matches: detection.matches.length,
                context
            });

        } catch (error) {
            loggingService.error('Failed to send security alert', {
                component: 'PreTransmissionFilterService',
                rule: rule.name,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Add custom filter rule
     */
    public async addCustomRule(rule: Omit<FilterRule, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
        if (!this.config.customRulesEnabled) {
            throw new Error('Custom rules are disabled');
        }

        const ruleId = this.generateRuleId();
        const now = Date.now();
        
        const fullRule: FilterRule = {
            ...rule,
            id: ruleId,
            createdAt: now,
            updatedAt: now
        };

        this.filterRules.set(ruleId, fullRule);

        // Store in cache
        await cacheService.set(`filter_rule:${ruleId}`, fullRule, 86400 * 30); // 30 days

        loggingService.info('Custom filter rule added', {
            component: 'PreTransmissionFilterService',
            ruleId,
            name: rule.name,
            category: rule.category,
            severity: rule.severity
        });

        this.emit('rule_added', { ruleId, rule: fullRule });

        return ruleId;
    }

    /**
     * Update filter rule
     */
    public async updateRule(ruleId: string, updates: Partial<FilterRule>): Promise<boolean> {
        const rule = this.filterRules.get(ruleId);
        if (!rule) {
            return false;
        }

        const updatedRule = {
            ...rule,
            ...updates,
            updatedAt: Date.now()
        };

        this.filterRules.set(ruleId, updatedRule);
        await cacheService.set(`filter_rule:${ruleId}`, updatedRule, 86400 * 30);

        loggingService.info('Filter rule updated', {
            component: 'PreTransmissionFilterService',
            ruleId,
            updates: Object.keys(updates)
        });

        this.emit('rule_updated', { ruleId, rule: updatedRule, updates });

        return true;
    }

    /**
     * Remove filter rule
     */
    public async removeRule(ruleId: string): Promise<boolean> {
        const rule = this.filterRules.get(ruleId);
        if (!rule) {
            return false;
        }

        this.filterRules.delete(ruleId);
        await cacheService.delete(`filter_rule:${ruleId}`);

        loggingService.info('Filter rule removed', {
            component: 'PreTransmissionFilterService',
            ruleId,
            name: rule.name
        });

        this.emit('rule_removed', { ruleId, rule });

        return true;
    }

    /**
     * Get all filter rules
     */
    public getFilterRules(): FilterRule[] {
        return Array.from(this.filterRules.values());
    }

    /**
     * Test filter rule against sample content
     */
    public testFilterRule(rule: FilterRule, content: string): Detection {
        return this.applyFilterRule(content, rule, { test: true });
    }

    /**
     * Bulk filter multiple content items
     */
    public async bulkFilterContent(
        items: Array<{ content: string; context: any }>,
        options: { 
            stopOnBlock?: boolean;
            maxConcurrency?: number;
        } = {}
    ): Promise<FilterResult[]> {
        const { stopOnBlock = false, maxConcurrency = 10 } = options;
        const results: FilterResult[] = [];

        // Process in batches to avoid overwhelming the system
        for (let i = 0; i < items.length; i += maxConcurrency) {
            const batch = items.slice(i, i + maxConcurrency);
            
            const batchPromises = batch.map(item => 
                this.filterContent(item.content, item.context)
            );
            
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);

            // Stop if any item is blocked and stopOnBlock is true
            if (stopOnBlock && batchResults.some(result => !result.allowed)) {
                break;
            }
        }

        return results;
    }

    /**
     * Get filtering statistics
     */
    public getStatistics(): FilterStatistics {
        return {
            ...this.filterStats,
            uptime: Date.now() - this.filterStats.uptime
        };
    }

    /**
     * Generate compliance scan report
     */
    public generateComplianceScan(
        _timeRange: { start: number; end: number }
    ): Promise<{
        scanId: string;
        summary: {
            totalContentScanned: number;
            piiDetections: number;
            blockedContent: number;
            riskDistribution: Record<string, number>;
        };
        violations: Array<{
            type: string;
            count: number;
            severity: string;
            samples: string[];
        }>;
        recommendations: string[];
    }> {
        const scanId = this.generateScanId();
        
        // This would scan historical data
        // For now, return current statistics
        return Promise.resolve({
            scanId,
            summary: {
                totalContentScanned: this.filterStats.totalRequests,
                piiDetections: this.filterStats.piiDetections,
                blockedContent: this.filterStats.blockedRequests,
                riskDistribution: this.filterStats.riskDistribution
            },
            violations: [],
            recommendations: [
                'Consider implementing additional PII detection patterns',
                'Review and update filter rules based on recent detections',
                'Ensure all high-risk content is properly handled'
            ]
        });
    }

    /**
     * Initialize default filter rules
     */
    private initializeDefaultRules(): void {
        for (const ruleTemplate of this.defaultRules) {
            const ruleId = this.generateRuleId();
            const rule: FilterRule = {
                ...ruleTemplate,
                id: ruleId,
                createdAt: Date.now(),
                updatedAt: Date.now()
            };
            this.filterRules.set(ruleId, rule);
        }

        loggingService.info('Default filter rules initialized', {
            component: 'PreTransmissionFilterService',
            ruleCount: this.filterRules.size
        });
    }

    /**
     * Initialize statistics
     */
    private initializeStats(): void {
        this.filterStats = {
            totalRequests: 0,
            filteredRequests: 0,
            blockedRequests: 0,
            redactedRequests: 0,
            piiDetections: 0,
            riskDistribution: { low: 0, medium: 0, high: 0, critical: 0 },
            categoryDistribution: { pii: 0, sensitive: 0, confidential: 0, compliance: 0 },
            topDetectedPatterns: [],
            averageProcessingTime: 0,
            uptime: Date.now()
        };
    }

    /**
     * Update statistics
     */
    private updateStatistics(result: FilterResult): void {
        this.filterStats.totalRequests++;
        
        if (result.modified || result.detections.length > 0) {
            this.filterStats.filteredRequests++;
        }
        
        if (!result.allowed) {
            this.filterStats.blockedRequests++;
        }
        
        if (result.metadata.redactionCount > 0) {
            this.filterStats.redactedRequests++;
        }

        // Update risk distribution
        const riskLevel = result.riskScore > 0.8 ? 'critical' :
                         result.riskScore > 0.6 ? 'high' :
                         result.riskScore > 0.3 ? 'medium' : 'low';
        this.filterStats.riskDistribution[riskLevel]++;

        // Update category distribution
        for (const detection of result.detections) {
            this.filterStats.categoryDistribution[detection.category as keyof typeof this.filterStats.categoryDistribution]++;
        }

        // Update average processing time
        const totalTime = (this.filterStats.averageProcessingTime * (this.filterStats.totalRequests - 1)) + 
                         result.metadata.processingTime;
        this.filterStats.averageProcessingTime = totalTime / this.filterStats.totalRequests;
    }

    /**
     * Generate cache key for content
     */
    private generateCacheKey(content: string, context: any): string {
        const contentHash = crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
        const contextHash = crypto.createHash('sha256').update(JSON.stringify(context)).digest('hex').substring(0, 8);
        return `filter_cache:${contentHash}:${contextHash}`;
    }

    /**
     * Cleanup cache to prevent memory leaks
     */
    private cleanupCache(): void {
        if (this.detectionCache.size > this.MAX_CACHE_SIZE) {
            // Remove oldest 20% of entries
            const entries = Array.from(this.detectionCache.entries());
            const toRemove = Math.floor(this.MAX_CACHE_SIZE * 0.2);
            
            for (let i = 0; i < toRemove; i++) {
                this.detectionCache.delete(entries[i][0]);
            }
        }
    }

    // Helper methods for ID generation
    private generateRuleId(): string {
        return `rule_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    private generateAlertId(): string {
        return `alert_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    private generateScanId(): string {
        return `scan_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    /**
     * Update configuration
     */
    public updateConfig(newConfig: Partial<FilterConfig>): void {
        this.config = { ...this.config, ...newConfig };
        
        loggingService.info('Pre-transmission filter configuration updated', {
            component: 'PreTransmissionFilterService',
            config: this.config
        });

        this.emit('config_updated', this.config);
    }

    /**
     * Enable/disable filtering
     */
    public setFilteringEnabled(enabled: boolean): void {
        this.config.enablePreTransmissionFiltering = enabled;
        
        loggingService.info('Pre-transmission filtering toggled', {
            component: 'PreTransmissionFilterService',
            enabled
        });
    }

    /**
     * Get recent security alerts
     */
    public async getRecentAlerts(limit: number = 50): Promise<any[]> {
        try {
            const cacheKey = `pre_transmission_alerts:recent:${limit}`;
            
            // Try to get from cache first
            const cached = await cacheService.get(cacheKey);
            if (cached) {
                return cached;
            }

            // Get alerts from the last 24 hours
            const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
            const alerts: any[] = [];

            // Collect alerts from detection cache and recent activity
            for (const [scanId, detection] of this.detectionCache.entries()) {
                if (detection.timestamp >= twentyFourHoursAgo) {
                    for (const det of detection.detections) {
                        if (det.severity === 'high' || det.severity === 'critical') {
                            alerts.push({
                                id: this.generateAlertId(),
                                scanId,
                                timestamp: detection.timestamp,
                                severity: det.severity,
                                category: det.category,
                                ruleName: det.ruleName,
                                ruleId: det.ruleId,
                                action: det.action,
                                matchCount: det.matches.length,
                                riskScore: detection.riskScore,
                                type: 'detection',
                                message: `${det.category.toUpperCase()} detected: ${det.ruleName}`,
                                details: {
                                    pattern: det.pattern,
                                    matches: det.matches.map(m => ({
                                        text: m.text.substring(0, 50) + '...',
                                        position: m.position,
                                        context: m.context.substring(0, 100) + '...'
                                    }))
                                }
                            });
                        }
                    }
                }
            }

            // Add system-level alerts
            const stats = this.getStatistics();
            if (stats.blockedRequests > 0) {
                alerts.push({
                    id: this.generateAlertId(),
                    timestamp: Date.now(),
                    severity: 'medium',
                    category: 'system',
                    type: 'blocked_requests',
                    message: `${stats.blockedRequests} requests blocked in last 24h`,
                    details: {
                        totalRequests: stats.totalRequests,
                        blockedRequests: stats.blockedRequests,
                        blockRate: ((stats.blockedRequests / stats.totalRequests) * 100).toFixed(2) + '%'
                    }
                });
            }

            if (stats.redactedRequests > stats.totalRequests * 0.1) {
                alerts.push({
                    id: this.generateAlertId(),
                    timestamp: Date.now(),
                    severity: 'low',
                    category: 'system',
                    type: 'high_redaction_rate',
                    message: `High redaction rate: ${((stats.redactedRequests / stats.totalRequests) * 100).toFixed(2)}%`,
                    details: {
                        redactedRequests: stats.redactedRequests,
                        totalRequests: stats.totalRequests
                    }
                });
            }

            // Sort by timestamp (newest first) and limit
            const sortedAlerts = alerts
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, limit);

            // Cache for 5 minutes
            await cacheService.set(cacheKey, sortedAlerts, 300);

            loggingService.info('Retrieved recent security alerts', {
                component: 'PreTransmissionFilterService',
                alertCount: sortedAlerts.length,
                limit
            });

            return sortedAlerts;
        } catch (error) {
            loggingService.error('Failed to get recent alerts', {
                component: 'PreTransmissionFilterService',
                error: error instanceof Error ? error.message : 'Unknown error',
                limit
            });
            return [];
        }
    }

    /**
     * Cleanup resources
     */
    public cleanup(): void {
        this.filterRules.clear();
        this.detectionCache.clear();
        this.removeAllListeners();
    }
}

// Export singleton instance
export const preTransmissionFilterService = PreTransmissionFilterService.getInstance();
