/**
 * SECURITY MODEL STRATEGY (Tiered Approach):
 * 
 * Primary: OpenAI GPT OSS Safeguard 20B (openai.gpt-oss-safeguard-20b)
 * - Fast, cost-effective initial screening
 * - Good for most moderation cases
 * 
 * Escalation: OpenAI GPT OSS Safeguard 120B (openai.gpt-oss-safeguard-120b)
 * - Deeper analysis for high-risk content
 * - Triggered when confidence < 0.7 or high-severity threats
 * 
 * Fallback: Amazon Nova Pro (amazon.nova-pro-v1:0)
 * - Used when Safeguard models unavailable
 * - Proven reliability
 * 
 * Final Fallback: Pattern-based detection
 * - Regex patterns if all AI models fail
 */
import { loggingService } from './logging.service';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { ServiceHelper } from '../utils/serviceHelper';
import { AICostTrackingService } from './aiCostTracking.service';

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

            loggingService.info('Starting output moderation check', { value:  { 
                requestId,
                contentLength: content.length,
                modelUsed
             } });

            // Stage 1: AI-powered comprehensive check (primary method)
            let moderationResult: OutputModerationResult;
            
            try {
                moderationResult = await this.runAIModerationCheck(content, config, requestId);
            } catch (error) {
                loggingService.warn('AI moderation failed, falling back to pattern matching', { error: error instanceof Error ? error.message : String(error) });
                // Fallback to pattern-based detection
                moderationResult = this.runPatternModerationCheck(content, config);
            }

            // Log threat detection if content is blocked
            if (moderationResult.isBlocked) {
                await this.logOutputThreatDetection(requestId, moderationResult, modelUsed);
            }

            loggingService.info('Output moderation check completed', { value:  { 
                requestId,
                isBlocked: moderationResult.isBlocked,
                violationCategories: moderationResult.violationCategories,
                action: moderationResult.action
             } });

            return moderationResult;

        } catch (error) {
            loggingService.error('Error in output moderation check', {
                error: error instanceof Error ? error.message : String(error),
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
     * AI-powered moderation check using Bedrock with tiered approach
     * Primary: Safeguard 20B → Escalate to 120B if needed → Fallback to Nova Pro
     */
    private static async runAIModerationCheck(
        content: string,
        config: OutputModerationConfig,
        requestId: string
    ): Promise<OutputModerationResult> {
        const startTime = Date.now();
        
        // Stage 1: Initial check with Safeguard 20B (fast, cost-effective)
        const primaryModelId = 'openai.gpt-oss-safeguard-20b';
        
        try {
            const initialResult = await this.invokeSafeguardModel(
                primaryModelId,
                content,
                config,
                requestId,
                startTime
            );
            
            // Escalate to 120B if:
            // 1. Low confidence (< 0.7) 
            // 2. High-severity threat detected
            const shouldEscalate = 
                initialResult.confidence < 0.7 ||
                this.isHighSeverityThreat(initialResult.violationCategories);
            
            if (shouldEscalate && initialResult.isBlocked) {
                loggingService.info('Escalating to Safeguard 120B for deeper analysis', { requestId });
                
                try {
                    const deepModelId = 'openai.gpt-oss-safeguard-120b';
                    return await this.invokeSafeguardModel(
                        deepModelId,
                        content,
                        config,
                        requestId,
                        startTime
                    );
                } catch (error) {
                    loggingService.warn('120B escalation failed, using 20B result', { 
                        error: error instanceof Error ? error.message : String(error) 
                    });
                    return initialResult;
                }
            }
            
            return initialResult;
            
        } catch (error) {
            loggingService.warn('Safeguard 20B failed, falling back to Nova Pro', { 
                error: error instanceof Error ? error.message : String(error) 
            });
            
            // Fallback to Nova Pro
            return await this.invokeNovaProFallback(content, config, requestId, startTime);
        }
    }

    /**
     * Check if threat categories are high severity (require 120B escalation)
     */
    private static isHighSeverityThreat(categories: string[]): boolean {
        const highSeverity = ['violence', 'self-harm', 'criminal', 'weapons', 'illegal-drugs'];
        return categories.some(cat => 
            highSeverity.some(severe => cat.toLowerCase().includes(severe))
        );
    }

    /**
     * Invoke Safeguard or Nova Pro model for moderation
     */
    private static async invokeSafeguardModel(
        modelId: string,
        content: string,
        config: OutputModerationConfig,
        requestId: string,
        startTime: number
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

        const estimatedInputTokens = Math.ceil(moderationPrompt.length / 4);

        try {
            const response = await ServiceHelper.withRetry(async () => {
                // Format request body based on model type
                let requestBody: any;
                
                if (modelId.includes('openai')) {
                    // OpenAI Safeguard models use simple string content format
                    requestBody = {
                        messages: [{ role: "user", content: moderationPrompt }],
                        max_tokens: 500,
                        temperature: 0.1
                    };
                } else {
                    // Nova Pro uses Converse API format with content array
                    requestBody = {
                        messages: [{ role: "user", content: [{ text: moderationPrompt }] }],
                        inferenceConfig: {
                            maxTokens: 500,
                            temperature: 0.1
                        }
                    };
                }
                
                const command = new InvokeModelCommand({
                    modelId,
                    body: JSON.stringify(requestBody),
                    contentType: 'application/json'
                });
                return this.bedrockClient.send(command);
            }, { maxRetries: 2, delayMs: 500, backoffMultiplier: 1.5 });

            const responseBody = JSON.parse(new TextDecoder().decode(response.body));
            const responseText = responseBody.output?.message?.content?.[0]?.text || 
                                responseBody.content?.[0]?.text || 
                                responseBody.output?.text || '';
            
            const analysis = JSON.parse(responseText);
            const estimatedOutputTokens = Math.ceil(responseText.length / 4);
            const latency = Date.now() - startTime;

            // Track AI cost for monitoring
            AICostTrackingService.trackCall({
                service: 'output_moderation',
                operation: 'ai_moderation_check',
                model: modelId,
                inputTokens: estimatedInputTokens,
                outputTokens: estimatedOutputTokens,
                estimatedCost: this.calculateCost(modelId, estimatedInputTokens, estimatedOutputTokens),
                latency,
                success: true,
                metadata: {
                    contentLength: content.length,
                    isViolation: analysis.isViolation || false,
                    threatLevel: analysis.threatLevel || 'low',
                    requestId
                }
            });

            return {
                isBlocked: analysis.isViolation || false,
                confidence: Math.min(analysis.confidence || 0.7, 1),
                violationCategories: analysis.categories || [],
                reason: analysis.reason || 'AI content analysis completed',
                stage: 'output-guard',
                originalContent: content,
                action: analysis.recommendedAction || config.action,
                details: {
                    method: modelId.includes('120b') ? 'safeguard_120b' : 
                            modelId.includes('20b') ? 'safeguard_20b' : 
                            modelId.includes('nova') ? 'nova_pro_fallback' : 'ai_moderation',
                    toxicityScore: analysis.toxicityScore,
                    threatLevel: analysis.threatLevel || 'low'
                }
            };

        } catch (error) {
            // Track failed AI call
            AICostTrackingService.trackCall({
                service: 'output_moderation',
                operation: 'ai_moderation_check',
                model: modelId,
                inputTokens: estimatedInputTokens,
                outputTokens: 0,
                estimatedCost: 0,
                latency: Date.now() - startTime,
                success: false,
                error: error instanceof Error ? error.message : String(error)
            });

            loggingService.error('AI output moderation failed', { 
                error: error instanceof Error ? error.message : String(error),
                modelId,
                requestId
            });
            throw error;
        }
    }

    /**
     * Fallback to Nova Pro when Safeguard models fail
     */
    private static async invokeNovaProFallback(
        content: string,
        config: OutputModerationConfig,
        requestId: string,
        startTime: number
    ): Promise<OutputModerationResult> {
        const fallbackModelId = 'amazon.nova-pro-v1:0';
        loggingService.info('Using Nova Pro fallback', { requestId });
        
        // Use existing invokeSafeguardModel logic (works for both OpenAI and Nova)
        return await this.invokeSafeguardModel(fallbackModelId, content, config, requestId, startTime);
    }

    /**
     * Calculate cost based on model pricing
     */
    private static calculateCost(modelId: string, inputTokens: number, outputTokens: number): number {
        const pricing: Record<string, { input: number; output: number }> = {
            'openai.gpt-oss-safeguard-20b': { input: 0.50, output: 1.50 },
            'openai.gpt-oss-safeguard-120b': { input: 2.00, output: 6.00 },
            'amazon.nova-pro-v1:0': { input: 0.80, output: 3.20 }
        };
        
        const modelPricing = pricing[modelId] || pricing['amazon.nova-pro-v1:0'];
        return (inputTokens * modelPricing.input + outputTokens * modelPricing.output) / 1_000_000;
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

            loggingService.info('Output threat logged', { value:  { 
                requestId,
                category: result.violationCategories[0],
                confidence: result.confidence,
                action: result.action
             } });

        } catch (error) {
            loggingService.error('Failed to log output threat detection', {
                error: error instanceof Error ? error.message : String(error),
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
            loggingService.error('Error getting output moderation analytics', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }
}

// Note: Types are already exported above in the interface declarations
