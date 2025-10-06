import { loggingService } from './logging.service';
import { cacheService } from './cache.service';
import { EventEmitter } from 'events';
import * as crypto from 'crypto';

/**
 * Data Classification Service
 * Automatically classifies and labels sensitive content before transmission
 */

export type DataClassificationLevel = 'public' | 'internal' | 'confidential' | 'restricted' | 'top_secret';
export type DataCategory = 'pii' | 'phi' | 'financial' | 'legal' | 'business' | 'technical' | 'operational' | 'personal';
export type ComplianceFramework = 'gdpr' | 'hipaa' | 'pci_dss' | 'sox' | 'ccpa' | 'soc2' | 'iso27001';

export interface DataClassification {
    classificationId: string;
    content: string;
    contentHash: string;
    timestamp: number;
    
    // Classification results
    classification: {
        level: DataClassificationLevel;
        categories: DataCategory[];
        complianceFrameworks: ComplianceFramework[];
        confidenceScore: number; // 0-1
        riskScore: number; // 0-1
    };
    
    // Detected entities
    entities: {
        pii: PIIEntity[];
        phi: PHIEntity[];
        financial: FinancialEntity[];
        business: BusinessEntity[];
        technical: TechnicalEntity[];
    };
    
    // Handling requirements
    handling: {
        encryptionRequired: boolean;
        retentionPeriod: number; // days
        accessRestrictions: string[];
        auditRequired: boolean;
        consentRequired: boolean;
        geographicRestrictions: string[];
        approvalRequired: boolean;
        redactionRequired: boolean;
    };
    
    // Context information
    context: {
        userId: string;
        sessionId: string;
        source: string;
        destination: string;
        purpose: string;
        userTier: string;
        ipAddress: string;
        userAgent: string;
    };
}

export interface PIIEntity {
    type: 'name' | 'email' | 'phone' | 'address' | 'ssn' | 'id_number' | 'date_of_birth';
    value: string;
    position: number;
    confidence: number;
    masked: boolean;
    category: 'direct' | 'quasi' | 'sensitive';
}

export interface PHIEntity {
    type: 'medical_condition' | 'medication' | 'treatment' | 'diagnosis' | 'patient_id' | 'medical_record';
    value: string;
    position: number;
    confidence: number;
    hipaaCategory: 'identifier' | 'health_info' | 'demographic';
}

export interface FinancialEntity {
    type: 'account_number' | 'routing_number' | 'credit_card' | 'ssn' | 'tax_id' | 'salary' | 'revenue';
    value: string;
    position: number;
    confidence: number;
    pciCategory?: 'cardholder_data' | 'sensitive_auth_data';
}

export interface BusinessEntity {
    type: 'trade_secret' | 'strategy' | 'financial_data' | 'customer_list' | 'pricing' | 'contract';
    value: string;
    position: number;
    confidence: number;
    businessImpact: 'low' | 'medium' | 'high' | 'critical';
}

export interface TechnicalEntity {
    type: 'api_key' | 'password' | 'token' | 'certificate' | 'private_key' | 'connection_string';
    value: string;
    position: number;
    confidence: number;
    securityImpact: 'low' | 'medium' | 'high' | 'critical';
}

export interface ClassificationRule {
    id: string;
    name: string;
    description: string;
    category: DataCategory;
    level: DataClassificationLevel;
    patterns: Array<{
        pattern: RegExp;
        weight: number;
        required: boolean;
    }>;
    contextRules: Array<{
        condition: (context: any) => boolean;
        weight: number;
    }>;
    complianceFrameworks: ComplianceFramework[];
    enabled: boolean;
    confidence_threshold: number;
}

export interface ClassificationConfig {
    enableAutoClassification: boolean;
    enableMLClassification: boolean;
    enableContextualAnalysis: boolean;
    defaultClassificationLevel: DataClassificationLevel;
    confidenceThreshold: number;
    enableRealTimeClassification: boolean;
    retainClassificationHistory: boolean;
    auditAllClassifications: boolean;
}

export class DataClassificationService extends EventEmitter {
    private static instance: DataClassificationService;
    
    private classificationRules: Map<string, ClassificationRule> = new Map();
    private classificationCache = new Map<string, DataClassification>();
    private classificationHistory: DataClassification[] = [];
    private readonly MAX_CACHE_SIZE = 10000;
    private readonly MAX_HISTORY_SIZE = 50000;
    
    // Configuration
    private config: ClassificationConfig = {
        enableAutoClassification: true,
        enableMLClassification: false, // Would require ML model integration
        enableContextualAnalysis: true,
        defaultClassificationLevel: 'internal',
        confidenceThreshold: 0.7,
        enableRealTimeClassification: true,
        retainClassificationHistory: true,
        auditAllClassifications: true
    };
    
    // Statistics
    private stats = {
        totalClassifications: 0,
        autoClassifications: 0,
        manualClassifications: 0,
        highRiskClassifications: 0,
        complianceClassifications: 0,
        averageConfidence: 0,
        averageProcessingTime: 0,
        uptime: Date.now()
    };

    // Default classification rules
    private defaultClassificationRules: Omit<ClassificationRule, 'id'>[] = [
        {
            name: 'Personal Identifiable Information (PII)',
            description: 'Detects personal information requiring GDPR/CCPA protection',
            category: 'pii',
            level: 'restricted',
            patterns: [
                { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, weight: 0.8, required: false },
                { pattern: /\b\d{3}-?\d{2}-?\d{4}\b/g, weight: 1.0, required: false },
                { pattern: /\b\d{3}[-.()]?\d{3}[-.]\d{4}\b/g, weight: 0.6, required: false }
            ],
            contextRules: [],
            complianceFrameworks: ['gdpr', 'ccpa'],
            enabled: true,
            confidence_threshold: 0.7
        },
        {
            name: 'Protected Health Information (PHI)',
            description: 'Detects health information requiring HIPAA protection',
            category: 'phi',
            level: 'restricted',
            patterns: [
                { pattern: /\b(?:patient|diagnosis|medication|treatment|medical record|health condition)\b/gi, weight: 0.9, required: true },
                { pattern: /\b(?:hospital|clinic|doctor|physician|nurse)\b/gi, weight: 0.5, required: false },
                { pattern: /\b(?:prescription|dosage|symptom|therapy)\b/gi, weight: 0.7, required: false }
            ],
            contextRules: [
                {
                    condition: (ctx) => ctx.source?.includes('medical') || ctx.purpose?.includes('health'),
                    weight: 0.8
                }
            ],
            complianceFrameworks: ['hipaa'],
            enabled: true,
            confidence_threshold: 0.8
        },
        {
            name: 'Financial Information',
            description: 'Detects financial data requiring PCI-DSS protection',
            category: 'financial',
            level: 'confidential',
            patterns: [
                { pattern: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, weight: 1.0, required: false },
                { pattern: /\b(?:account number|routing number|bank account|credit score)\b/gi, weight: 0.8, required: false },
                { pattern: /\b(?:salary|income|revenue|profit|financial statement)\b/gi, weight: 0.6, required: false }
            ],
            contextRules: [
                {
                    condition: (ctx) => ctx.purpose?.includes('financial') || ctx.source?.includes('payment'),
                    weight: 0.7
                }
            ],
            complianceFrameworks: ['pci_dss', 'sox'],
            enabled: true,
            confidence_threshold: 0.7
        },
        {
            name: 'Business Confidential',
            description: 'Detects business confidential information',
            category: 'business',
            level: 'confidential',
            patterns: [
                { pattern: /\b(?:confidential|proprietary|trade secret|internal only)\b/gi, weight: 0.9, required: true },
                { pattern: /\b(?:strategy|roadmap|competitive|acquisition|merger)\b/gi, weight: 0.6, required: false },
                { pattern: /\b(?:customer list|pricing|contract|agreement)\b/gi, weight: 0.7, required: false }
            ],
            contextRules: [],
            complianceFrameworks: ['soc2'],
            enabled: true,
            confidence_threshold: 0.6
        },
        {
            name: 'Technical Secrets',
            description: 'Detects technical credentials and secrets',
            category: 'technical',
            level: 'top_secret',
            patterns: [
                { pattern: /\b(?:password|secret|key|token)\s*[:=]\s*\S+/gi, weight: 1.0, required: false },
                { pattern: /eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/g, weight: 1.0, required: false },
                { pattern: /\b[A-Za-z0-9]{20,}\b/g, weight: 0.5, required: false }
            ],
            contextRules: [
                {
                    condition: (ctx) => ctx.source?.includes('config') || ctx.source?.includes('env'),
                    weight: 0.8
                }
            ],
            complianceFrameworks: ['soc2', 'iso27001'],
            enabled: true,
            confidence_threshold: 0.8
        }
    ];

    private constructor() {
        super();
        this.initializeDefaultRules();
        this.startCleanupInterval();
    }

    public static getInstance(): DataClassificationService {
        if (!DataClassificationService.instance) {
            DataClassificationService.instance = new DataClassificationService();
        }
        return DataClassificationService.instance;
    }

    /**
     * Classify content and determine handling requirements
     */
    public async classifyContent(
        content: string,
        context: DataClassification['context']
    ): Promise<DataClassification> {
        const startTime = Date.now();
        const classificationId = this.generateClassificationId();
        const contentHash = this.generateContentHash(content);

        try {
            // Check cache first
            const cached = await this.getCachedClassification(contentHash);
            if (cached) {
                this.stats.totalClassifications++;
                return cached;
            }

            // Perform entity detection
            const entities = await this.detectEntities(content, context);
            
            // Apply classification rules
            const classificationResult = await this.applyClassificationRules(content, context, entities);
            
            // Determine handling requirements
            const handling = this.determineHandlingRequirements(classificationResult, entities, context);

            // Create classification record
            const classification: DataClassification = {
                classificationId,
                content,
                contentHash,
                timestamp: Date.now(),
                classification: classificationResult,
                entities,
                handling,
                context
            };

            // Store classification
            await this.storeClassification(classification);
            
            // Cache result
            this.classificationCache.set(contentHash, classification);
            
            // Add to history
            if (this.config.retainClassificationHistory) {
                this.classificationHistory.push(classification);
                this.cleanupHistory();
            }

            // Update statistics
            this.updateStatistics(classification, Date.now() - startTime);

            // Emit classification event
            this.emit('content_classified', {
                classificationId,
                level: classification.classification.level,
                categories: classification.classification.categories,
                riskScore: classification.classification.riskScore,
                complianceFrameworks: classification.classification.complianceFrameworks
            });

            // Log high-risk classifications
            if (classification.classification.riskScore > 0.8) {
                loggingService.warn('High-risk content classified', {
                    component: 'DataClassificationService',
                    classificationId,
                    level: classification.classification.level,
                    riskScore: classification.classification.riskScore,
                    categories: classification.classification.categories,
                    context: context.source
                });
            }

            return classification;

        } catch (error) {
            loggingService.error('Content classification failed', {
                component: 'DataClassificationService',
                error: error instanceof Error ? error.message : String(error),
                contentLength: content.length,
                context: context.source
            });

            // Return safe default classification
            return this.createDefaultClassification(classificationId, content, contentHash, context);
        }
    }

    /**
     * Detect entities in content
     */
    private async detectEntities(content: string, context: DataClassification['context']): Promise<DataClassification['entities']> {
        const entities: DataClassification['entities'] = {
            pii: [],
            phi: [],
            financial: [],
            business: [],
            technical: []
        };

        // PII Detection
        entities.pii = this.detectPIIEntities(content);
        
        // PHI Detection
        entities.phi = this.detectPHIEntities(content, context);
        
        // Financial Detection
        entities.financial = this.detectFinancialEntities(content);
        
        // Business Detection
        entities.business = this.detectBusinessEntities(content, context);
        
        // Technical Detection
        entities.technical = this.detectTechnicalEntities(content);

        return entities;
    }

    /**
     * Detect PII entities
     */
    private detectPIIEntities(content: string): PIIEntity[] {
        const entities: PIIEntity[] = [];
        
        const piiPatterns = {
            email: { 
                pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
                category: 'direct' as const
            },
            phone: { 
                pattern: /\b\d{3}[-.()]?\d{3}[-.]\d{4}\b/g,
                category: 'direct' as const
            },
            ssn: { 
                pattern: /\b\d{3}-?\d{2}-?\d{4}\b/g,
                category: 'direct' as const
            },
            name: { 
                pattern: /\b[A-Z][a-z]+ [A-Z][a-z]+\b/g,
                category: 'quasi' as const
            },
            address: { 
                pattern: /\b\d+\s+[A-Za-z0-9\s,.-]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd)\b/gi,
                category: 'direct' as const
            }
        };

        for (const [type, config] of Object.entries(piiPatterns)) {
            let match;
            config.pattern.lastIndex = 0;
            
            while ((match = config.pattern.exec(content)) !== null) {
                entities.push({
                    type: type as PIIEntity['type'],
                    value: match[0],
                    position: match.index,
                    confidence: this.calculateEntityConfidence(type, match[0], content),
                    masked: false,
                    category: config.category
                });
                
                if (!config.pattern.global) break;
            }
        }

        return entities;
    }

    /**
     * Detect PHI entities
     */
    private detectPHIEntities(content: string, context: DataClassification['context']): PHIEntity[] {
        const entities: PHIEntity[] = [];
        
        const phiPatterns = {
            medical_condition: {
                pattern: /\b(?:diabetes|hypertension|cancer|depression|anxiety|covid|flu|pneumonia)\b/gi,
                category: 'health_info' as const
            },
            medication: {
                pattern: /\b(?:aspirin|ibuprofen|acetaminophen|insulin|metformin|lisinopril)\b/gi,
                category: 'health_info' as const
            },
            treatment: {
                pattern: /\b(?:surgery|chemotherapy|radiation|therapy|treatment|procedure)\b/gi,
                category: 'health_info' as const
            },
            patient_id: {
                pattern: /\b(?:patient|medical|health)\s*(?:id|number|record)\s*[:=]?\s*[A-Z0-9-]+/gi,
                category: 'identifier' as const
            }
        };

        // Higher confidence if context suggests medical content
        const contextBoost = context.purpose?.includes('medical') || 
                           context.source?.includes('health') ? 0.2 : 0;

        for (const [type, config] of Object.entries(phiPatterns)) {
            let match;
            config.pattern.lastIndex = 0;
            
            while ((match = config.pattern.exec(content)) !== null) {
                entities.push({
                    type: type as PHIEntity['type'],
                    value: match[0],
                    position: match.index,
                    confidence: Math.min(1.0, this.calculateEntityConfidence(type, match[0], content) + contextBoost),
                    hipaaCategory: config.category
                });
                
                if (!config.pattern.global) break;
            }
        }

        return entities;
    }

    /**
     * Detect financial entities
     */
    private detectFinancialEntities(content: string): FinancialEntity[] {
        const entities: FinancialEntity[] = [];
        
        const financialPatterns = {
            credit_card: {
                pattern: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g,
                pciCategory: 'cardholder_data' as const
            },
            account_number: {
                pattern: /\b(?:account|acct)\s*(?:number|#|num)\s*[:=]?\s*[0-9-]+/gi,
                pciCategory: undefined
            },
            salary: {
                pattern: /\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\b\d+k?\s*(?:salary|income|wage)/gi,
                pciCategory: undefined
            },
            tax_id: {
                pattern: /\b(?:tax|ein|federal)\s*(?:id|number)\s*[:=]?\s*[0-9-]+/gi,
                pciCategory: undefined
            }
        };

        for (const [type, config] of Object.entries(financialPatterns)) {
            let match;
            config.pattern.lastIndex = 0;
            
            while ((match = config.pattern.exec(content)) !== null) {
                entities.push({
                    type: type as FinancialEntity['type'],
                    value: match[0],
                    position: match.index,
                    confidence: this.calculateEntityConfidence(type, match[0], content),
                    pciCategory: config.pciCategory
                });
                
                if (!config.pattern.global) break;
            }
        }

        return entities;
    }

    /**
     * Detect business entities
     */
    private detectBusinessEntities(content: string, context: DataClassification['context']): BusinessEntity[] {
        const entities: BusinessEntity[] = [];
        
        const businessPatterns = {
            trade_secret: {
                pattern: /\b(?:confidential|proprietary|trade secret|internal only|do not share)\b/gi,
                impact: 'high' as const
            },
            strategy: {
                pattern: /\b(?:strategy|roadmap|business plan|competitive advantage|market share)\b/gi,
                impact: 'medium' as const
            },
            customer_list: {
                pattern: /\b(?:customer list|client data|contact database|lead list)\b/gi,
                impact: 'high' as const
            },
            pricing: {
                pattern: /\b(?:pricing|price list|cost structure|margin|discount)\b/gi,
                impact: 'medium' as const
            }
        };

        // Business context increases confidence
        const contextBoost = context.purpose?.includes('business') || 
                           context.userTier === 'premium' ? 0.1 : 0;

        for (const [type, config] of Object.entries(businessPatterns)) {
            let match;
            config.pattern.lastIndex = 0;
            
            while ((match = config.pattern.exec(content)) !== null) {
                entities.push({
                    type: type as BusinessEntity['type'],
                    value: match[0],
                    position: match.index,
                    confidence: Math.min(1.0, this.calculateEntityConfidence(type, match[0], content) + contextBoost),
                    businessImpact: config.impact
                });
                
                if (!config.pattern.global) break;
            }
        }

        return entities;
    }

    /**
     * Detect technical entities
     */
    private detectTechnicalEntities(content: string): TechnicalEntity[] {
        const entities: TechnicalEntity[] = [];
        
        const technicalPatterns = {
            api_key: {
                pattern: /\b(?:api[_-]?key|access[_-]?token)\s*[:=]\s*[A-Za-z0-9+/=]{20,}/gi,
                impact: 'critical' as const
            },
            password: {
                pattern: /\b(?:password|passwd|pwd)\s*[:=]\s*\S+/gi,
                impact: 'critical' as const
            },
            token: {
                pattern: /eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/g,
                impact: 'critical' as const
            },
            private_key: {
                pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/gi,
                impact: 'critical' as const
            },
            connection_string: {
                pattern: /\b(?:mongodb|mysql|postgres|redis):\/\/[^\s]+/gi,
                impact: 'high' as const
            }
        };

        for (const [type, config] of Object.entries(technicalPatterns)) {
            let match;
            config.pattern.lastIndex = 0;
            
            while ((match = config.pattern.exec(content)) !== null) {
                entities.push({
                    type: type as TechnicalEntity['type'],
                    value: match[0],
                    position: match.index,
                    confidence: this.calculateEntityConfidence(type, match[0], content),
                    securityImpact: config.impact
                });
                
                if (!config.pattern.global) break;
            }
        }

        return entities;
    }

    /**
     * Apply classification rules to determine data classification
     */
    private async applyClassificationRules(
        content: string,
        context: DataClassification['context'],
        entities: DataClassification['entities']
    ): Promise<DataClassification['classification']> {
        let highestLevel: DataClassificationLevel = this.config.defaultClassificationLevel;
        const categories: DataCategory[] = [];
        const complianceFrameworks: ComplianceFramework[] = [];
        let totalConfidence = 0;
        let ruleCount = 0;

        // Apply each classification rule
        for (const rule of this.classificationRules.values()) {
            if (!rule.enabled) continue;

            const ruleResult = await this.evaluateClassificationRule(rule, content, context, entities);
            
            if (ruleResult.matches && ruleResult.confidence >= rule.confidence_threshold) {
                // Update classification level if higher
                if (this.isHigherClassificationLevel(rule.level, highestLevel)) {
                    highestLevel = rule.level;
                }
                
                // Add category if not already present
                if (!categories.includes(rule.category)) {
                    categories.push(rule.category);
                }
                
                // Add compliance frameworks
                for (const framework of rule.complianceFrameworks) {
                    if (!complianceFrameworks.includes(framework)) {
                        complianceFrameworks.push(framework);
                    }
                }
                
                totalConfidence += ruleResult.confidence;
                ruleCount++;
            }
        }

        // Calculate overall confidence
        const confidenceScore = ruleCount > 0 ? totalConfidence / ruleCount : 0;
        
        // Calculate risk score based on classification
        const riskScore = this.calculateClassificationRiskScore(highestLevel, categories, entities);

        return {
            level: highestLevel,
            categories,
            complianceFrameworks,
            confidenceScore,
            riskScore
        };
    }

    /**
     * Evaluate a single classification rule
     */
    private async evaluateClassificationRule(
        rule: ClassificationRule,
        content: string,
        context: DataClassification['context'],
        entities: DataClassification['entities']
    ): Promise<{ matches: boolean; confidence: number }> {
        let totalWeight = 0;
        let matchedWeight = 0;
        let hasRequiredMatch = false;

        // Check pattern matches
        for (const patternRule of rule.patterns) {
            totalWeight += patternRule.weight;
            
            patternRule.pattern.lastIndex = 0;
            const hasMatch = patternRule.pattern.test(content);
            
            if (hasMatch) {
                matchedWeight += patternRule.weight;
                if (patternRule.required) {
                    hasRequiredMatch = true;
                }
            } else if (patternRule.required) {
                // Required pattern not found
                return { matches: false, confidence: 0 };
            }
        }

        // Check context rules
        for (const contextRule of rule.contextRules) {
            totalWeight += contextRule.weight;
            
            if (contextRule.condition(context)) {
                matchedWeight += contextRule.weight;
            }
        }

        // Check if required patterns are satisfied
        const hasRequiredPatterns = rule.patterns.some(p => p.required);
        if (hasRequiredPatterns && !hasRequiredMatch) {
            return { matches: false, confidence: 0 };
        }

        const confidence = totalWeight > 0 ? matchedWeight / totalWeight : 0;
        const matches = confidence >= rule.confidence_threshold;

        return { matches, confidence };
    }

    /**
     * Determine handling requirements based on classification
     */
    private determineHandlingRequirements(
        classification: DataClassification['classification'],
        entities: DataClassification['entities'],
        context: DataClassification['context']
    ): DataClassification['handling'] {
        const handling: DataClassification['handling'] = {
            encryptionRequired: false,
            retentionPeriod: 365, // Default 1 year
            accessRestrictions: [],
            auditRequired: false,
            consentRequired: false,
            geographicRestrictions: [],
            approvalRequired: false,
            redactionRequired: false
        };

        // Base requirements on classification level
        switch (classification.level) {
            case 'top_secret':
                handling.encryptionRequired = true;
                handling.retentionPeriod = 90;
                handling.accessRestrictions = ['admin_only', 'mfa_required'];
                handling.auditRequired = true;
                handling.approvalRequired = true;
                handling.redactionRequired = true;
                break;
                
            case 'restricted':
                handling.encryptionRequired = true;
                handling.retentionPeriod = 180;
                handling.accessRestrictions = ['authorized_only'];
                handling.auditRequired = true;
                handling.consentRequired = true;
                handling.redactionRequired = true;
                break;
                
            case 'confidential':
                handling.encryptionRequired = true;
                handling.retentionPeriod = 365;
                handling.auditRequired = true;
                handling.redactionRequired = classification.riskScore > 0.7;
                break;
                
            case 'internal':
                handling.retentionPeriod = 730; // 2 years
                handling.auditRequired = classification.riskScore > 0.5;
                break;
                
            case 'public':
                handling.retentionPeriod = 1095; // 3 years
                break;
        }

        // Additional requirements based on compliance frameworks
        for (const framework of classification.complianceFrameworks) {
            switch (framework) {
                case 'gdpr':
                    handling.consentRequired = true;
                    handling.retentionPeriod = Math.min(handling.retentionPeriod, 365);
                    handling.geographicRestrictions = ['eu_only'];
                    break;
                    
                case 'hipaa':
                    handling.encryptionRequired = true;
                    handling.accessRestrictions.push('healthcare_authorized');
                    handling.auditRequired = true;
                    handling.retentionPeriod = Math.min(handling.retentionPeriod, 2555); // 7 years
                    break;
                    
                case 'pci_dss':
                    handling.encryptionRequired = true;
                    handling.retentionPeriod = Math.min(handling.retentionPeriod, 365);
                    handling.auditRequired = true;
                    break;
                    
                case 'sox':
                    handling.auditRequired = true;
                    handling.retentionPeriod = Math.min(handling.retentionPeriod, 2555); // 7 years
                    break;
            }
        }

        // Entity-specific requirements
        if (entities.pii.some(e => e.category === 'direct')) {
            handling.consentRequired = true;
            handling.redactionRequired = true;
        }
        
        if (entities.technical.some(e => e.securityImpact === 'critical')) {
            handling.encryptionRequired = true;
            handling.approvalRequired = true;
        }
        
        if (entities.phi.length > 0) {
            handling.encryptionRequired = true;
            handling.auditRequired = true;
        }

        return handling;
    }

    /**
     * Calculate entity confidence score
     */
    private calculateEntityConfidence(type: string, value: string, content: string): number {
        let confidence = 0.5; // Base confidence
        
        // Pattern-specific confidence adjustments
        switch (type) {
            case 'email':
                confidence = value.includes('@') && value.includes('.') ? 0.9 : 0.3;
                break;
            case 'ssn':
                confidence = /^\d{3}-\d{2}-\d{4}$/.test(value) ? 0.95 : 0.7;
                break;
            case 'credit_card':
                confidence = this.isValidCreditCard(value) ? 0.95 : 0.6;
                break;
            case 'phone':
                confidence = /^\d{3}[-.()]?\d{3}[-.]\d{4}$/.test(value) ? 0.8 : 0.5;
                break;
            default:
                confidence = 0.6;
        }
        
        // Context-based adjustments
        const contextWords = content.toLowerCase();
        if (contextWords.includes('example') || contextWords.includes('sample') || contextWords.includes('test')) {
            confidence *= 0.3; // Likely test data
        }
        
        return Math.min(1.0, confidence);
    }

    /**
     * Calculate classification risk score
     */
    private calculateClassificationRiskScore(
        level: DataClassificationLevel,
        categories: DataCategory[],
        entities: DataClassification['entities']
    ): number {
        let riskScore = 0;

        // Base risk from classification level
        const levelRisk = {
            public: 0.0,
            internal: 0.2,
            confidential: 0.5,
            restricted: 0.8,
            top_secret: 1.0
        };
        riskScore = levelRisk[level];

        // Add risk from categories
        const categoryRisk = {
            pii: 0.3,
            phi: 0.4,
            financial: 0.3,
            legal: 0.2,
            business: 0.2,
            technical: 0.4,
            operational: 0.1,
            personal: 0.3
        };
        
        for (const category of categories) {
            riskScore += categoryRisk[category] || 0;
        }

        // Add risk from entities
        const entityCounts = {
            pii: entities.pii.length,
            phi: entities.phi.length,
            financial: entities.financial.length,
            technical: entities.technical.filter(e => e.securityImpact === 'critical').length
        };

        for (const [type, count] of Object.entries(entityCounts)) {
            if (count > 0) {
                riskScore += Math.min(count * 0.1, 0.3); // Max 0.3 per entity type
            }
        }

        return Math.min(1.0, riskScore);
    }

    /**
     * Check if one classification level is higher than another
     */
    private isHigherClassificationLevel(level1: DataClassificationLevel, level2: DataClassificationLevel): boolean {
        const levels = ['public', 'internal', 'confidential', 'restricted', 'top_secret'];
        return levels.indexOf(level1) > levels.indexOf(level2);
    }

    /**
     * Validate credit card using Luhn algorithm
     */
    private isValidCreditCard(cardNumber: string): boolean {
        const num = cardNumber.replace(/[^0-9]/g, '');
        if (num.length < 13 || num.length > 19) return false;
        
        let sum = 0;
        let isEven = false;
        
        for (let i = num.length - 1; i >= 0; i--) {
            let digit = parseInt(num.charAt(i), 10);
            
            if (isEven) {
                digit *= 2;
                if (digit > 9) {
                    digit -= 9;
                }
            }
            
            sum += digit;
            isEven = !isEven;
        }
        
        return sum % 10 === 0;
    }

    /**
     * Get cached classification
     */
    private async getCachedClassification(contentHash: string): Promise<DataClassification | null> {
        try {
            const cached = this.classificationCache.get(contentHash);
            if (cached) return cached;
            
            // Check persistent cache
            const cacheKey = `data_classification:${contentHash}`;
            const persistentCached = await cacheService.get(cacheKey);
            if (persistentCached) {
                const classification = persistentCached as DataClassification;
                this.classificationCache.set(contentHash, classification);
                return classification;
            }
            
            return null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Store classification
     */
    private async storeClassification(classification: DataClassification): Promise<void> {
        try {
            const cacheKey = `data_classification:${classification.contentHash}`;
            await cacheService.set(cacheKey, classification, 86400 * 7); // 7 days
        } catch (error) {
            loggingService.error('Failed to store classification', {
                component: 'DataClassificationService',
                classificationId: classification.classificationId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Create default classification for errors
     */
    private createDefaultClassification(
        classificationId: string,
        content: string,
        contentHash: string,
        context: DataClassification['context']
    ): DataClassification {
        return {
            classificationId,
            content,
            contentHash,
            timestamp: Date.now(),
            classification: {
                level: 'restricted', // Safe default
                categories: ['operational'],
                complianceFrameworks: [],
                confidenceScore: 0,
                riskScore: 1.0 // High risk due to classification failure
            },
            entities: {
                pii: [],
                phi: [],
                financial: [],
                business: [],
                technical: []
            },
            handling: {
                encryptionRequired: true,
                retentionPeriod: 30,
                accessRestrictions: ['admin_only'],
                auditRequired: true,
                consentRequired: true,
                geographicRestrictions: [],
                approvalRequired: true,
                redactionRequired: true
            },
            context
        };
    }

    /**
     * Initialize default classification rules
     */
    private initializeDefaultRules(): void {
        for (const ruleTemplate of this.defaultClassificationRules) {
            const ruleId = this.generateRuleId();
            const rule: ClassificationRule = {
                ...ruleTemplate,
                id: ruleId
            };
            this.classificationRules.set(ruleId, rule);
        }

        loggingService.info('Default classification rules initialized', {
            component: 'DataClassificationService',
            ruleCount: this.classificationRules.size
        });
    }

    /**
     * Update statistics
     */
    private updateStatistics(classification: DataClassification, processingTime: number): void {
        this.stats.totalClassifications++;
        this.stats.autoClassifications++;
        
        if (classification.classification.riskScore > 0.7) {
            this.stats.highRiskClassifications++;
        }
        
        if (classification.classification.complianceFrameworks.length > 0) {
            this.stats.complianceClassifications++;
        }

        // Update average confidence
        const totalConfidence = (this.stats.averageConfidence * (this.stats.totalClassifications - 1)) + 
                               classification.classification.confidenceScore;
        this.stats.averageConfidence = totalConfidence / this.stats.totalClassifications;

        // Update average processing time
        const totalTime = (this.stats.averageProcessingTime * (this.stats.totalClassifications - 1)) + processingTime;
        this.stats.averageProcessingTime = totalTime / this.stats.totalClassifications;
    }

    /**
     * Cleanup history to prevent memory leaks
     */
    private cleanupHistory(): void {
        if (this.classificationHistory.length > this.MAX_HISTORY_SIZE) {
            this.classificationHistory = this.classificationHistory.slice(-this.MAX_HISTORY_SIZE);
        }
    }

    /**
     * Start cleanup interval
     */
    private startCleanupInterval(): void {
        setInterval(() => {
            // Cleanup cache
            if (this.classificationCache.size > this.MAX_CACHE_SIZE) {
                const entries = Array.from(this.classificationCache.entries());
                entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
                
                const toRemove = Math.floor(this.MAX_CACHE_SIZE * 0.2);
                for (let i = 0; i < toRemove; i++) {
                    this.classificationCache.delete(entries[i][0]);
                }
            }
            
            // Cleanup history
            this.cleanupHistory();
        }, 300000); // Every 5 minutes
    }

    // Helper methods
    private generateClassificationId(): string {
        return `cls_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    private generateRuleId(): string {
        return `clsrule_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    private generateContentHash(content: string): string {
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    /**
     * Get service statistics
     */
    public getStatistics(): typeof this.stats & { cacheSize: number; historySize: number } {
        return {
            ...this.stats,
            cacheSize: this.classificationCache.size,
            historySize: this.classificationHistory.length
        };
    }

    /**
     * Update configuration
     */
    public updateConfig(newConfig: Partial<ClassificationConfig>): void {
        this.config = { ...this.config, ...newConfig };
        
        loggingService.info('Data classification configuration updated', {
            component: 'DataClassificationService',
            config: this.config
        });

        this.emit('config_updated', this.config);
    }

    /**
     * Cleanup resources
     */
    public cleanup(): void {
        this.classificationRules.clear();
        this.classificationCache.clear();
        this.classificationHistory = [];
        this.removeAllListeners();
    }
}

// Export singleton instance
export const dataClassificationService = DataClassificationService.getInstance();
