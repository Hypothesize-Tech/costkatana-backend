import { logger } from '../utils/logger';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { retryBedrockOperation } from '../utils/bedrockRetry';

export interface OutputModerationResult {
    isBlocked: boolean;
    confidence: number; // 0-1
    violationCategories: string[];
    reason: string;
    stage: 'output-guard';
    sanitizedContent?: string;
    originalContent: string;
    action: 'allow' | 'annotate' | 'redact' | 'block';
    details: {
        method: string;
        toxicityScore?: number;
        piiDetected?: boolean;
        threatLevel: 'low' | 'medium' | 'high';
    };
}

export interface OutputModerationConfig {
    enableOutputModeration: boolean;
    toxicityThreshold: number; // 0-1, higher = more strict
    enablePIIDetection: boolean;
    enableToxicityCheck: boolean;
    enableHateSpeechCheck: boolean;
    enableSexualContentCheck: boolean;
    enableViolenceCheck: boolean;
    enableSelfHarmCheck: boolean;
    action: 'allow' | 'annotate' | 'redact' | 'block';
}

export class OutputModerationService {
    private static bedrockClient = new BedrockRuntimeClient({ 
        region: process.env.AWS_REGION || 'us-east-1' 
    });

    // Toxic content patterns for fallback detection
    private static readonly TOXIC_PATTERNS = {
        toxicity: {
            patterns: [
                /\b(stupid|idiot|moron|dumb|retard)\b/gi,
                /\b(kill\s+yourself|kys)\b/gi,
                /\b(go\s+die|drop\s+dead)\b/gi
            ],
            severity: 'medium'
        },
        hateSpeech: {
            patterns: [
                /\b(terrorist|nazi|fascist)\b/gi,
                /\b(racial|ethnic)\s+slur/gi
            ],
            severity: 'high'
        },
        sexualContent: {
            patterns: [
                /\b(explicit\s+sexual|pornographic|sexually\s+explicit)\b/gi,
                /\b(sexual\s+activity|sexual\s+content)\b/gi
            ],
            severity: 'high'
        },
        violence: {
            patterns: [
                /\b(graphic\s+violence|violent\s+imagery)\b/gi,
                /\b(torture|murder|killing)\s+(details|instructions)/gi
            ],
            severity: 'high'
        },
        selfHarm: {
            patterns: [
                /\b(suicide\s+methods|self\s+harm\s+instructions)\b/gi,
                /\b(how\s+to\s+hurt\s+yourself)\b/gi
            ],
            severity: 'high'
        }
    };

    /**
     * Main output moderation check - processes model output through safety layers
     */
    static async moderateOutput(
        content: string,
        config: OutputModerationConfig,
        requestId: string,
        modelUsed?: string
    ): Promise<OutputModerationResult> {
        try {
            if (!config.enableOutputModeration) {
                return {
                    isBlocked: false,
                    confidence: 0.0,
                    violationCategories: [],
                    reason: 'Output moderation disabled',
                    stage: 'output-guard',
                    originalContent: content,
                    action: 'allow',
                    details: {
                        method: 'disabled',
                        threatLevel: 'low'
                    }
                };
            }

            logger.info('Starting output moderation check', {
                requestId,
                contentLength: content.length,
                modelUsed
            });

            // Stage 1: AI-powered comprehensive check (primary method)
            let moderationResult: OutputModerationResult;
            
            try {
                moderationResult = await this.runAIModerationCheck(content, config, requestId);
            } catch (error) {
                logger.warn('AI moderation failed, falling back to pattern matching', error);
                // Fallback to pattern-based detection
                moderationResult = this.runPatternModerationCheck(content, config);
            }

            // Stage 2: PII Detection if enabled
            if (config.enablePIIDetection && !moderationResult.isBlocked) {
                const { PIIDetectionService } = await import('./piiDetection.service');
                const piiResult = await PIIDetectionService.detectPII(content, false); // Use regex only for speed
                
                if (piiResult.hasPII && piiResult.riskLevel === 'high') {
                    moderationResult.isBlocked = true;
                    moderationResult.violationCategories.push('privacy_violations');
                    moderationResult.reason = 'High-risk PII detected in model output';
                    moderationResult.details.piiDetected = true;
                    
                    // Redact PII if action is redact
                    if (config.action === 'redact') {
                        moderationResult.sanitizedContent = PIIDetectionService.sanitizeText(content, piiResult);
                        moderationResult.action = 'redact';
                    }
                }
            }

            // Log threat detection if content is blocked
            if (moderationResult.isBlocked) {
                await this.logOutputThreatDetection(requestId, moderationResult, modelUsed);
            }

            logger.info('Output moderation check completed', {
                requestId,
                isBlocked: moderationResult.isBlocked,
                violationCategories: moderationResult.violationCategories,
                action: moderationResult.action
            });

            return moderationResult;

        } catch (error) {
            logger.error('Error in output moderation check', error as Error, {
                requestId,
                contentLength: content.length
            });

            // In case of error, allow the content to proceed (fail-open) but log the error
            return {
                isBlocked: false,
                confidence: 0.0,
                violationCategories: [],
                reason: 'Output moderation check failed - allowing content',
                stage: 'output-guard',
                originalContent: content,
                action: 'allow',
                details: {
                    method: 'error_fallback',
                    threatLevel: 'low'
                }
            };
        }
    }

    /**
     * AI-powered moderation check using Bedrock
     */
    private static async runAIModerationCheck(
        content: string,
        config: OutputModerationConfig,
        _requestId: string
    ): Promise<OutputModerationResult> {
        const moderationPrompt = `
You are a content moderation system. Analyze this model output for policy violations:

Content: "${content}"

Check for these categories:
${config.enableToxicityCheck ? '- Toxicity/harassment' : ''}
${config.enableHateSpeechCheck ? '- Hate speech' : ''}
${config.enableSexualContentCheck ? '- Sexual content' : ''}
${config.enableViolenceCheck ? '- Violence/harm' : ''}
${config.enableSelfHarmCheck ? '- Self-harm content' : ''}

Toxicity threshold: ${config.toxicityThreshold}

Respond with JSON only:
{
    "isViolation": boolean,
    "confidence": number (0-1),
    "categories": ["category1", "category2"],
    "reason": "explanation",
    "toxicityScore": number (0-1),
    "threatLevel": "low|medium|high",
    "recommendedAction": "allow|annotate|redact|block"
}`;

        try {
            const response = await retryBedrockOperation(async () => {
                const command = new InvokeModelCommand({
                    modelId: process.env.AWS_BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0',
                    body: JSON.stringify({
                        anthropic_version: "bedrock-2023-05-31",
                        max_tokens: 500,
                        messages: [{ role: "user", content: moderationPrompt }]
                    }),
                    contentType: 'application/json'
                });
                return this.bedrockClient.send(command);
            });

            const responseBody = JSON.parse(new TextDecoder().decode(response.body));
            const analysis = JSON.parse(responseBody.content[0].text);

            return {
                isBlocked: analysis.isViolation || false,
                confidence: Math.min(analysis.confidence || 0.7, 1),
                violationCategories: analysis.categories || [],
                reason: analysis.reason || 'AI content analysis completed',
                stage: 'output-guard',
                originalContent: content,
                action: analysis.recommendedAction || config.action,
                details: {
                    method: 'ai_moderation',
                    toxicityScore: analysis.toxicityScore,
                    threatLevel: analysis.threatLevel || 'low'
                }
            };

        } catch (error) {
            logger.error('AI output moderation failed', error);
            throw error;
        }
    }

    /**
     * Pattern-based moderation check (fallback)
     */
    private static runPatternModerationCheck(
        content: string,
        config: OutputModerationConfig
    ): OutputModerationResult {
        const detectedViolations: string[] = [];
        let maxSeverity: 'low' | 'medium' | 'high' = 'low';
        let highestConfidence = 0;

        Object.entries(this.TOXIC_PATTERNS).forEach(([category, { patterns, severity }]) => {
            // Check if this category is enabled in config
            const categoryEnabledMap: Record<string, boolean> = {
                toxicity: config.enableToxicityCheck,
                hateSpeech: config.enableHateSpeechCheck,
                sexualContent: config.enableSexualContentCheck,
                violence: config.enableViolenceCheck,
                selfHarm: config.enableSelfHarmCheck
            };

            if (!categoryEnabledMap[category]) return;

            patterns.forEach(pattern => {
                if (pattern.test(content)) {
                    detectedViolations.push(category);
                    if (severity === 'high') {
                        maxSeverity = 'high';
                        highestConfidence = Math.max(highestConfidence, 0.8);
                    } else if (severity === 'medium' && maxSeverity !== 'high') {
                        maxSeverity = 'medium';
                        highestConfidence = Math.max(highestConfidence, 0.6);
                    }
                }
            });
        });

        const uniqueViolations = [...new Set(detectedViolations)];
        const isBlocked = uniqueViolations.length > 0 && maxSeverity !== 'low';

        return {
            isBlocked,
            confidence: isBlocked ? highestConfidence : 0.9,
            violationCategories: uniqueViolations,
            reason: isBlocked ? 
                `Pattern-based detection found violations: ${uniqueViolations.join(', ')}` : 
                'No violations detected (pattern check)',
            stage: 'output-guard',
            originalContent: content,
            action: isBlocked ? config.action : 'allow',
            details: {
                method: 'pattern_matching',
                threatLevel: maxSeverity
            }
        };
    }

    /**
     * Log output threat detection to database
     */
    private static async logOutputThreatDetection(
        requestId: string,
        result: OutputModerationResult,
        modelUsed?: string
    ): Promise<void> {
        try {
            const { ThreatLog } = await import('../models/ThreatLog');
            
            await ThreatLog.create({
                requestId,
                threatCategory: result.violationCategories[0] || 'harmful_content',
                confidence: result.confidence,
                stage: result.stage,
                reason: result.reason,
                details: {
                    ...result.details,
                    modelUsed,
                    violationCategories: result.violationCategories,
                    action: result.action,
                    contentLength: result.originalContent.length
                },
                costSaved: 0, // Output moderation doesn't save cost directly
                timestamp: new Date()
            });

            logger.info('Output threat logged', {
                requestId,
                category: result.violationCategories[0],
                confidence: result.confidence,
                action: result.action
            });

        } catch (error) {
            logger.error('Failed to log output threat detection', error as Error, {
                requestId
            });
        }
    }

    /**
     * Get output moderation analytics
     */
    static async getOutputModerationAnalytics(
        userId?: string,
        dateRange?: { start: Date; end: Date }
    ): Promise<{
        totalResponses: number;
        blockedResponses: number;
        redactedResponses: number;
        annotatedResponses: number;
        violationsByCategory: Record<string, number>;
        blockRateByModel: Record<string, number>;
        averageConfidence: number;
    }> {
        try {
            const { ThreatLog } = await import('../models/ThreatLog');
            
            const matchQuery: any = {
                stage: 'output-guard'
            };
            
            if (userId) {
                matchQuery.userId = userId;
            }
            
            if (dateRange) {
                matchQuery.timestamp = {
                    $gte: dateRange.start,
                    $lte: dateRange.end
                };
            }

            const analytics = await ThreatLog.aggregate([
                { $match: matchQuery },
                {
                    $group: {
                        _id: null,
                        totalResponses: { $sum: 1 },
                        blockedResponses: {
                            $sum: {
                                $cond: [{ $eq: ["$details.action", "block"] }, 1, 0]
                            }
                        },
                        redactedResponses: {
                            $sum: {
                                $cond: [{ $eq: ["$details.action", "redact"] }, 1, 0]
                            }
                        },
                        annotatedResponses: {
                            $sum: {
                                $cond: [{ $eq: ["$details.action", "annotate"] }, 1, 0]
                            }
                        },
                        violationsByCategory: {
                            $push: "$threatCategory"
                        },
                        modelUsage: {
                            $push: {
                                model: "$details.modelUsed",
                                blocked: { $eq: ["$details.action", "block"] }
                            }
                        },
                        totalConfidence: { $sum: "$confidence" }
                    }
                }
            ]);

            if (analytics.length === 0) {
                return {
                    totalResponses: 0,
                    blockedResponses: 0,
                    redactedResponses: 0,
                    annotatedResponses: 0,
                    violationsByCategory: {},
                    blockRateByModel: {},
                    averageConfidence: 0
                };
            }

            const result = analytics[0];
            
            // Count violations by category
            const violationsByCategory: Record<string, number> = {};
            result.violationsByCategory.forEach((category: string) => {
                violationsByCategory[category] = (violationsByCategory[category] || 0) + 1;
            });

            // Calculate block rate by model
            const blockRateByModel: Record<string, number> = {};
            const modelStats: Record<string, { total: number; blocked: number }> = {};
            
            result.modelUsage.forEach((usage: any) => {
                if (usage.model) {
                    if (!modelStats[usage.model]) {
                        modelStats[usage.model] = { total: 0, blocked: 0 };
                    }
                    modelStats[usage.model].total++;
                    if (usage.blocked) {
                        modelStats[usage.model].blocked++;
                    }
                }
            });

            Object.entries(modelStats).forEach(([model, stats]) => {
                blockRateByModel[model] = stats.total > 0 ? (stats.blocked / stats.total) * 100 : 0;
            });

            return {
                totalResponses: result.totalResponses,
                blockedResponses: result.blockedResponses,
                redactedResponses: result.redactedResponses,
                annotatedResponses: result.annotatedResponses,
                violationsByCategory,
                blockRateByModel,
                averageConfidence: result.totalResponses > 0 ? result.totalConfidence / result.totalResponses : 0
            };

        } catch (error) {
            logger.error('Error getting output moderation analytics', error);
            throw error;
        }
    }
}

// Note: Types are already exported above in the interface declarations
