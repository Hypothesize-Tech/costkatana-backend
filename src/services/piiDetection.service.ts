import { logger } from '../utils/logger';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { retryBedrockOperation } from '../utils/bedrockRetry';

export interface PIIDetectionResult {
    hasPII: boolean;
    confidence: number; // 0-1
    piiTypes: string[];
    detectedEntities: Array<{
        type: string;
        text: string;
        confidence: number;
        startIndex: number;
        endIndex: number;
    }>;
    riskLevel: 'low' | 'medium' | 'high';
    recommendations: string[];
}

export interface PIIDetectionBatch {
    results: PIIDetectionResult[];
    totalProcessed: number;
    totalWithPII: number;
    overallRiskAssessment: 'low' | 'medium' | 'high';
    summary: {
        piiTypeBreakdown: Record<string, number>;
        highRiskItems: number;
        recommendedActions: string[];
    };
}

export class PIIDetectionService {
    private static bedrockClient = new BedrockRuntimeClient({ 
        region: process.env.AWS_REGION || 'us-east-1' 
    });

    // PII detection patterns using regex
    private static readonly PII_PATTERNS = {
        email: {
            pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
            risk: 'medium'
        },
        phone: {
            pattern: /(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})(?:\s?(?:ext|extension|x)\.?\s?(\d+))?/g,
            risk: 'medium'
        },
        ssn: {
            pattern: /\b(?!000|666|9\d{2})\d{3}[-\s]?(?!00)\d{2}[-\s]?(?!0000)\d{4}\b/g,
            risk: 'high'
        },
        creditCard: {
            pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3[0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
            risk: 'high'
        },
        ipAddress: {
            pattern: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
            risk: 'low'
        }
    };

    /**
     * Detect PII in a single text string
     */
    static async detectPII(text: string, useAI: boolean = true): Promise<PIIDetectionResult> {
        try {
            // Start with regex-based detection
            const regexResults = this.detectPIIWithRegex(text);
            
            // Enhance with AI if enabled and available
            let aiResults: PIIDetectionResult | null = null;
            if (useAI) {
                try {
                    aiResults = await this.detectPIIWithAI(text);
                } catch (error) {
                    logger.warn('AI PII detection failed, using regex only:', error);
                }
            }

            // Merge results (AI takes precedence where available)
            const finalResult = this.mergeDetectionResults(regexResults, aiResults);

            logger.info(`PII detection completed for text (${text.length} chars): ${finalResult.piiTypes.length} types found`);
            return finalResult;

        } catch (error) {
            logger.error('Error in PII detection:', error);
            throw error;
        }
    }

    /**
     * Detect PII using regex patterns
     */
    private static detectPIIWithRegex(text: string): PIIDetectionResult {
        const detectedEntities: PIIDetectionResult['detectedEntities'] = [];
        const piiTypes: string[] = [];
        let maxRisk: 'low' | 'medium' | 'high' = 'low';

        Object.entries(this.PII_PATTERNS).forEach(([type, { pattern, risk }]) => {
            const matches = Array.from(text.matchAll(pattern));
            
            if (matches.length > 0) {
                piiTypes.push(type);
                
                matches.forEach(match => {
                    if (match.index !== undefined) {
                        detectedEntities.push({
                            type,
                            text: match[0],
                            confidence: 0.8,
                            startIndex: match.index,
                            endIndex: match.index + match[0].length
                        });
                    }
                });

                // Update max risk
                if (risk === 'high' || (risk === 'medium' && maxRisk === 'low')) {
                    maxRisk = risk;
                }
            }
        });

        const hasPII = piiTypes.length > 0;
        const confidence = hasPII ? 0.8 : 0.9;
        
        return {
            hasPII,
            confidence,
            piiTypes,
            detectedEntities,
            riskLevel: maxRisk,
            recommendations: this.generateItemRecommendations(piiTypes, maxRisk)
        };
    }

    /**
     * Detect PII using AI (AWS Bedrock)
     */
    private static async detectPIIWithAI(text: string): Promise<PIIDetectionResult> {
        const prompt = `
You are a privacy expert analyzing text for personally identifiable information (PII).
Analyze this text and identify any PII: "${text}"
Respond with JSON: {"hasPII": boolean, "confidence": 0-1, "piiTypes": ["email", "phone"], "riskLevel": "low|medium|high"}`;

        try {
            const response = await retryBedrockOperation(async () => {
                const command = new InvokeModelCommand({
                    modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
                    body: JSON.stringify({
                        anthropic_version: "bedrock-2023-05-31",
                        max_tokens: 500,
                        messages: [{ role: "user", content: prompt }]
                    }),
                    contentType: 'application/json'
                });
                return this.bedrockClient.send(command);
            });

            const responseBody = JSON.parse(new TextDecoder().decode(response.body));
            const aiAnalysis = JSON.parse(responseBody.content[0].text);

            return {
                hasPII: aiAnalysis.hasPII,
                confidence: Math.min(aiAnalysis.confidence || 0.7, 1),
                piiTypes: aiAnalysis.piiTypes || [],
                detectedEntities: [],
                riskLevel: aiAnalysis.riskLevel || 'low',
                recommendations: this.generateItemRecommendations(aiAnalysis.piiTypes || [], aiAnalysis.riskLevel || 'low')
            };

        } catch (error) {
            logger.error('AI PII detection failed:', error);
            throw error;
        }
    }

    /**
     * Merge regex and AI detection results
     */
    private static mergeDetectionResults(
        regexResult: PIIDetectionResult, 
        aiResult: PIIDetectionResult | null
    ): PIIDetectionResult {
        if (!aiResult) return regexResult;

        const allPiiTypes = [...new Set([...regexResult.piiTypes, ...aiResult.piiTypes])];
        const riskLevels = ['low', 'medium', 'high'];
        const maxRisk = riskLevels.indexOf(aiResult.riskLevel) > riskLevels.indexOf(regexResult.riskLevel)
                       ? aiResult.riskLevel : regexResult.riskLevel;

        return {
            hasPII: allPiiTypes.length > 0,
            confidence: aiResult.confidence > 0.5 ? aiResult.confidence : regexResult.confidence,
            piiTypes: allPiiTypes,
            detectedEntities: regexResult.detectedEntities,
            riskLevel: maxRisk as 'low' | 'medium' | 'high',
            recommendations: this.generateItemRecommendations(allPiiTypes, maxRisk as 'low' | 'medium' | 'high')
        };
    }

    /**
     * Generate recommendations for individual items
     */
    private static generateItemRecommendations(piiTypes: string[], riskLevel: string): string[] {
        const recommendations: string[] = [];

        if (piiTypes.length === 0) {
            return ['No PII detected - safe for training'];
        }

        if (piiTypes.includes('ssn') || piiTypes.includes('creditCard')) {
            recommendations.push('⚠️ HIGH RISK: Contains sensitive data - EXCLUDE from training');
        }

        if (piiTypes.includes('email') || piiTypes.includes('phone')) {
            recommendations.push('Contains contact info - consider anonymization');
        }

        if (riskLevel === 'high') {
            recommendations.push('🚨 Recommend EXCLUDING this item from training dataset');
        }

        return recommendations;
    }

    /**
     * Sanitize text by replacing PII with placeholders
     */
    static sanitizeText(text: string, detectionResult: PIIDetectionResult): string {
        let sanitizedText = text;
        const sortedEntities = detectionResult.detectedEntities.sort((a, b) => b.startIndex - a.startIndex);

        sortedEntities.forEach(entity => {
            const placeholder = this.getPlaceholderForType(entity.type);
            sanitizedText = sanitizedText.substring(0, entity.startIndex) + 
                           placeholder + 
                           sanitizedText.substring(entity.endIndex);
        });

        return sanitizedText;
    }

    private static getPlaceholderForType(piiType: string): string {
        const placeholders: Record<string, string> = {
            email: '[EMAIL]',
            phone: '[PHONE]',
            ssn: '[SSN]',
            creditCard: '[CREDIT_CARD]'
        };
        return placeholders[piiType] || '[PII]';
    }

    /**
     * Detect PII in multiple texts (batch processing)
     */
    static async detectPIIBatch(
        texts: string[], 
        useAI: boolean = true
    ): Promise<PIIDetectionBatch> {
        try {
            const results: PIIDetectionResult[] = [];
            let totalWithPII = 0;
            const piiTypeBreakdown: Record<string, number> = {};
            let highRiskItems = 0;

            for (let i = 0; i < texts.length; i++) {
                const result = await this.detectPII(texts[i], useAI);
                results.push(result);

                if (result.hasPII) {
                    totalWithPII++;
                    
                    // Update type breakdown
                    result.piiTypes.forEach(type => {
                        piiTypeBreakdown[type] = (piiTypeBreakdown[type] || 0) + 1;
                    });

                    if (result.riskLevel === 'high') {
                        highRiskItems++;
                    }
                }

                // Small delay to avoid overwhelming APIs
                if (useAI && i % 10 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            // Overall risk assessment
            const highRiskPercentage = (highRiskItems / texts.length) * 100;
            const piiPercentage = (totalWithPII / texts.length) * 100;
            
            let overallRiskAssessment: 'low' | 'medium' | 'high' = 'low';
            if (highRiskPercentage > 10 || piiPercentage > 50) {
                overallRiskAssessment = 'high';
            } else if (highRiskPercentage > 5 || piiPercentage > 20) {
                overallRiskAssessment = 'medium';
            }

            // Generate recommendations
            const recommendedActions = this.generateBatchRecommendations(piiTypeBreakdown, overallRiskAssessment, piiPercentage);

            return {
                results,
                totalProcessed: texts.length,
                totalWithPII,
                overallRiskAssessment,
                summary: {
                    piiTypeBreakdown,
                    highRiskItems,
                    recommendedActions
                }
            };

        } catch (error) {
            logger.error('Error in batch PII detection:', error);
            throw error;
        }
    }

    /**
     * Generate recommendations for batch results
     */
    private static generateBatchRecommendations(
        piiTypeBreakdown: Record<string, number>,
        overallRisk: string,
        piiPercentage: number
    ): string[] {
        const recommendations: string[] = [];

        if (overallRisk === 'high') {
            recommendations.push('🚨 HIGH RISK DATASET: Immediate action required');
            recommendations.push('Review all high-risk items before proceeding with training');
        }

        if (piiPercentage > 30) {
            recommendations.push(`${piiPercentage.toFixed(1)}% of items contain PII - consider data cleaning`);
        }

        if (piiTypeBreakdown.ssn || piiTypeBreakdown.creditCard) {
            recommendations.push('Financial/identity data detected - implement strict access controls');
        }

        if (piiTypeBreakdown.email || piiTypeBreakdown.phone) {
            recommendations.push('Contact information detected - implement masking');
        }

        if (Object.keys(piiTypeBreakdown).length > 3) {
            recommendations.push('Multiple PII types detected - comprehensive data governance needed');
        }

            return recommendations;
  }
}

// Export additional types for evaluation service
export interface PIIDetectionBatch {
  results: PIIDetectionResult[];
  totalProcessed: number;
  totalWithPII: number;
  overallRiskAssessment: 'low' | 'medium' | 'high';
  summary: {
    piiTypeBreakdown: Record<string, number>;
    highRiskItems: number;
    recommendedActions: string[];
  };
}