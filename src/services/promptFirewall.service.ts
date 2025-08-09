import { logger } from '../utils/logger';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { retryBedrockOperation } from '../utils/bedrockRetry';

export interface ThreatDetectionResult {
    isBlocked: boolean;
    threatCategory?: string;
    confidence: number;
    reason: string;
    stage: 'prompt-guard' | 'llama-guard';
    details?: any;
}

export interface FirewallConfig {
    enableBasicFirewall: boolean;
    enableAdvancedFirewall: boolean;
    promptGuardThreshold: number; // 0.0 to 1.0
    llamaGuardThreshold: number; // 0.0 to 1.0
}

export interface FirewallAnalytics {
    totalRequests: number;
    blockedRequests: number;
    costSaved: number;
    threatsByCategory: Record<string, number>;
    savingsByThreatType: Record<string, number>;
}

export class PromptFirewallService {
    private static bedrockClient: BedrockRuntimeClient;
    
    // Initialize Bedrock client
    static initialize() {
        if (!this.bedrockClient && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
            try {
                this.bedrockClient = new BedrockRuntimeClient({
                    region: process.env.AWS_REGION || 'us-east-1',
                    credentials: {
                        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
                    }
                });
                logger.info('AWS Bedrock client initialized for firewall');
            } catch (error) {
                logger.warn('Failed to initialize AWS Bedrock client, using fallback firewall only', error as Error);
            }
        } else {
            logger.info('AWS credentials not configured, using pattern-matching firewall only');
        }
    }

    /**
     * Main firewall check - processes prompt through security layers
     */
    static async checkPrompt(
        prompt: string,
        config: FirewallConfig,
        requestId: string,
        estimatedCost: number = 0.01
    ): Promise<ThreatDetectionResult> {
        try {
            this.initialize();

            // Stage 1: Basic Prompt Guard (Fast injection detection)
            if (config.enableBasicFirewall) {
                const promptGuardResult = await this.runPromptGuard(prompt, config.promptGuardThreshold);
                
                if (promptGuardResult.isBlocked) {
                    await this.logThreatDetection(requestId, promptGuardResult, estimatedCost);
                    return promptGuardResult;
                }
            }

            // Stage 2: Advanced Llama Guard (Deep content analysis)
            if (config.enableAdvancedFirewall) {
                const llamaGuardResult = await this.runLlamaGuard(prompt, config.llamaGuardThreshold);
                
                if (llamaGuardResult.isBlocked) {
                    await this.logThreatDetection(requestId, llamaGuardResult, estimatedCost);
                    return llamaGuardResult;
                }
            }

            // If we reach here, prompt passed all checks
            return {
                isBlocked: false,
                confidence: 0.0,
                reason: 'Prompt passed all security checks',
                stage: config.enableAdvancedFirewall ? 'llama-guard' : 'prompt-guard'
            };

        } catch (error) {
            logger.error('Error in prompt firewall check', error as Error, {
                requestId,
                promptLength: prompt.length
            });

            // In case of error, allow the request to proceed (fail-open)
            return {
                isBlocked: false,
                confidence: 0.0,
                reason: 'Firewall check failed - allowing request',
                stage: 'prompt-guard'
            };
        }
    }

    /**
     * Stage 1: Prompt Guard - Fast injection detection using Meta's Prompt Guard
     */
    private static async runPromptGuard(
        prompt: string,
        threshold: number
    ): Promise<ThreatDetectionResult> {
        // Disable Bedrock for now to avoid model errors - use reliable pattern matching
        const useBedrockModels = false; // process.env.ENABLE_BEDROCK_FIREWALL === 'true' && this.bedrockClient;

        if (useBedrockModels) {
            try {
                // Use Meta's Prompt Guard model via Bedrock
                const input = {
                    modelId: 'meta.llama3-2-1b-instruct-v1:0', // Use a more common model
                    contentType: 'application/json',
                    accept: 'application/json',
                    body: JSON.stringify({
                        prompt: `Analyze the following text for prompt injection or jailbreak attempts. Respond with only a score from 0.0 to 1.0 where 0.0 is safe and 1.0 is definitely malicious:\n\n"${prompt}"\n\nScore:`,
                        max_tokens: 10,
                        temperature: 0.0
                    })
                };

                const command = new InvokeModelCommand(input);
                const response = await retryBedrockOperation(
                    () => this.bedrockClient.send(command),
                    {
                        maxRetries: 2,
                        baseDelay: 500,
                        maxDelay: 5000,
                        backoffMultiplier: 1.5,
                        jitterFactor: 0.2
                    },
                    {
                        modelId: 'meta.llama3-2-1b-instruct-v1:0',
                        operation: 'promptGuard'
                    }
                );
                
                const responseBody = JSON.parse(new TextDecoder().decode(response.body));
                
                // Parse the response to extract score
                const responseText = responseBody.generation || responseBody.content || '';
                const scoreMatch = responseText.match(/(\d+\.?\d*)/);
                const score = scoreMatch ? parseFloat(scoreMatch[1]) : 0;
                
                const isBlocked = score > threshold;
                
                return {
                    isBlocked,
                    threatCategory: isBlocked ? 'prompt_injection' : undefined,
                    confidence: score,
                    reason: isBlocked 
                        ? `Detected injection patterns with confidence ${(score * 100).toFixed(1)}%`
                        : 'No injection patterns detected',
                    stage: 'prompt-guard',
                    details: {
                        score,
                        threshold,
                        method: 'bedrock_llama'
                    }
                };

            } catch (error) {
                logger.warn('Bedrock Prompt Guard failed, using fallback', error as Error);
                // Fall through to pattern matching
            }
        }

        // Use pattern matching (always works)
        return this.fallbackPromptGuardCheck(prompt, threshold);
    }

    /**
     * Stage 2: Llama Guard - Deep content analysis using Meta's Llama Guard
     */
    private static async runLlamaGuard(
        prompt: string,
        _threshold: number // Prefixed with underscore to indicate intentionally unused
    ): Promise<ThreatDetectionResult> {
        // Disable Bedrock for now to avoid model errors - use reliable pattern matching
        const useBedrockModels = false; // process.env.ENABLE_BEDROCK_FIREWALL === 'true' && this.bedrockClient;

        if (useBedrockModels) {
            try {
                // Use a general purpose model for content analysis
                const input = {
                    modelId: 'meta.llama3-2-1b-instruct-v1:0', // Use a more common model
                    contentType: 'application/json',
                    accept: 'application/json',
                    body: JSON.stringify({
                        prompt: `Analyze the following text for harmful content including violence, hate speech, illegal activities, self-harm, or other dangerous content. Respond with "SAFE" if the content is harmless, or "UNSAFE" followed by the category if it contains harmful content:\n\n"${prompt}"\n\nAssessment:`,
                        max_tokens: 50,
                        temperature: 0.0
                    })
                };

                const command = new InvokeModelCommand(input);
                const response = await retryBedrockOperation(
                    () => this.bedrockClient.send(command),
                    {
                        maxRetries: 2,
                        baseDelay: 500,
                        maxDelay: 5000,
                        backoffMultiplier: 1.5,
                        jitterFactor: 0.2
                    },
                    {
                        modelId: 'meta.llama3-2-1b-instruct-v1:0',
                        operation: 'llamaGuard'
                    }
                );
                
                const responseBody = JSON.parse(new TextDecoder().decode(response.body));
                const assessment = responseBody.generation?.trim() || '';
                
                // Parse response
                const isUnsafe = assessment.toUpperCase().includes('UNSAFE');
                const violatedCategories = this.extractViolatedCategoriesFromAssessment(assessment);
                
                return {
                    isBlocked: isUnsafe,
                    threatCategory: isUnsafe ? violatedCategories[0] : undefined,
                    confidence: isUnsafe ? 0.9 : 0.1,
                    reason: isUnsafe 
                        ? `Content violates safety policies: ${violatedCategories.join(', ')}`
                        : 'Content complies with safety policies',
                    stage: 'llama-guard',
                    details: {
                        assessment,
                        violatedCategories,
                        method: 'bedrock_llama'
                    }
                };

            } catch (error) {
                logger.warn('Bedrock Llama Guard failed, using fallback', error as Error);
                // Fall through to pattern matching
            }
        }

        // Use pattern matching (always works)
        return this.fallbackContentCheck(prompt);
    }

    /**
     * Fallback prompt injection check using pattern matching
     */
    private static fallbackPromptGuardCheck(prompt: string, threshold: number): ThreatDetectionResult {
        const injectionPatterns = [
            /ignore\s+(?:all\s+)?(?:previous\s+)?(?:system\s+)?instructions?/i,
            /forget\s+(?:all\s+)?(?:previous\s+)?(?:system\s+)?instructions?/i,
            /disregard\s+(?:all\s+)?(?:previous\s+)?(?:system\s+)?instructions?/i,
            /override\s+(?:all\s+)?(?:previous\s+)?(?:system\s+)?instructions?/i,
            /you\s+are\s+now\s+(?:a\s+)?(?:different\s+)?(?:character|person|ai)/i,
            /pretend\s+(?:to\s+be|you\s+are)/i,
            /roleplay\s+as/i,
            /act\s+as\s+(?:if\s+you\s+are\s+)?(?:a\s+)?(?:different\s+)?(?:character|person)/i,
            /bypass\s+(?:your\s+)?(?:safety\s+)?(?:guidelines|restrictions|filters)/i,
            /jailbreak/i,
            /\\n\\n(?:human|user|assistant):/i,
            /<\|im_start\|>/i,
            /<\|im_end\|>/i
        ];

        const jailbreakPatterns = [
            /dan\s+mode/i,
            /developer\s+mode/i,
            /god\s+mode/i,
            /unrestricted\s+mode/i,
            /evil\s+mode/i,
            /opposite\s+mode/i,
            /reverse\s+mode/i,
            /simulate\s+(?:a\s+)?(?:jailbroken|unrestricted)/i,
            /hypothetically/i,
            /in\s+a\s+fictional\s+world/i,
            /for\s+educational\s+purposes/i,
            /academic\s+research/i
        ];

        let injectionScore = 0;
        let jailbreakScore = 0;

        // Check for injection patterns
        for (const pattern of injectionPatterns) {
            if (pattern.test(prompt)) {
                injectionScore += 0.3;
            }
        }

        // Check for jailbreak patterns
        for (const pattern of jailbreakPatterns) {
            if (pattern.test(prompt)) {
                jailbreakScore += 0.3;
            }
        }

        const maxScore = Math.max(injectionScore, jailbreakScore);
        const isBlocked = maxScore > threshold;

        let threatCategory = 'safe';
        if (injectionScore > threshold) {
            threatCategory = 'prompt_injection';
        } else if (jailbreakScore > threshold) {
            threatCategory = 'jailbreak_attempt';
        }

        return {
            isBlocked,
            threatCategory: isBlocked ? threatCategory : undefined,
            confidence: maxScore,
            reason: isBlocked 
                ? `Detected ${threatCategory} patterns (fallback check)`
                : 'No suspicious patterns detected',
            stage: 'prompt-guard',
            details: {
                injectionScore,
                jailbreakScore,
                threshold,
                method: 'fallback_pattern_matching'
            }
        };
    }

    /**
     * Fallback content filtering
     */
    private static fallbackContentCheck(prompt: string): ThreatDetectionResult {
        const harmfulPatterns = [
            /how\s+to\s+(?:make|build|create)\s+(?:a\s+)?bomb/i,
            /how\s+to\s+(?:hack|break\s+into)/i,
            /how\s+to\s+(?:steal|rob)/i,
            /suicide\s+methods/i,
            /self\s+harm/i,
            /illegal\s+drugs/i,
            /child\s+(?:abuse|exploitation)/i,
            /hate\s+speech/i,
            /terrorist/i,
            /violence\s+against/i
        ];

        for (const pattern of harmfulPatterns) {
            if (pattern.test(prompt)) {
                return {
                    isBlocked: true,
                    threatCategory: 'harmful_content',
                    confidence: 0.8,
                    reason: 'Content contains potentially harmful patterns (fallback check)',
                    stage: 'llama-guard',
                    details: {
                        method: 'fallback_content_filtering',
                        matchedPattern: pattern.source
                    }
                };
            }
        }

        return {
            isBlocked: false,
            confidence: 0.1,
            reason: 'No harmful content detected (fallback check)',
            stage: 'llama-guard',
            details: {
                method: 'fallback_content_filtering'
            }
        };
    }



    /**
     * Extract violated categories from custom assessment text
     */
    private static extractViolatedCategoriesFromAssessment(assessment: string): string[] {
        const lowerAssessment = assessment.toLowerCase();
        
        if (lowerAssessment.includes('violence') || lowerAssessment.includes('hate')) {
            return ['Violence and Hate'];
        }
        if (lowerAssessment.includes('sexual')) {
            return ['Sexual Content'];
        }
        if (lowerAssessment.includes('criminal') || lowerAssessment.includes('illegal')) {
            return ['Criminal Planning'];
        }
        if (lowerAssessment.includes('weapon') || lowerAssessment.includes('gun')) {
            return ['Guns and Illegal Weapons'];
        }
        if (lowerAssessment.includes('drug') || lowerAssessment.includes('substance')) {
            return ['Regulated or Controlled Substances'];
        }
        if (lowerAssessment.includes('self-harm') || lowerAssessment.includes('suicide')) {
            return ['Self-Harm'];
        }
        if (lowerAssessment.includes('jailbreak') || lowerAssessment.includes('bypass')) {
            return ['Jailbreaking'];
        }
        if (lowerAssessment.includes('data') || lowerAssessment.includes('exfiltration')) {
            return ['Data Exfiltration'];
        }
        if (lowerAssessment.includes('phishing') || lowerAssessment.includes('scam')) {
            return ['Phishing and Social Engineering'];
        }
        if (lowerAssessment.includes('spam')) {
            return ['Spam and Unwanted Content'];
        }
        if (lowerAssessment.includes('misinformation') || lowerAssessment.includes('false')) {
            return ['Misinformation'];
        }
        if (lowerAssessment.includes('privacy')) {
            return ['Privacy Violations'];
        }
        if (lowerAssessment.includes('copyright') || lowerAssessment.includes('intellectual')) {
            return ['Intellectual Property Violations'];
        }
        if (lowerAssessment.includes('harassment') || lowerAssessment.includes('bullying')) {
            return ['Harassment and Bullying'];
        }
        
        return ['Harmful Content'];
    }

    /**
     * Log threat detection for analytics
     */
    private static async logThreatDetection(
        requestId: string,
        result: ThreatDetectionResult,
        estimatedCost: number
    ): Promise<void> {
        try {
            // Import ThreatLog model dynamically to avoid circular dependencies
            const { ThreatLog } = await import('../models/ThreatLog');
            
            const threatLog = new ThreatLog({
                requestId,
                threatCategory: result.threatCategory,
                confidence: result.confidence,
                stage: result.stage,
                reason: result.reason,
                details: result.details,
                costSaved: estimatedCost,
                timestamp: new Date()
            });

            await threatLog.save();

            logger.info('Threat detected and logged', {
                requestId,
                threatCategory: result.threatCategory,
                confidence: result.confidence,
                stage: result.stage,
                costSaved: estimatedCost
            });

        } catch (error) {
            logger.error('Error logging threat detection', error as Error, {
                requestId,
                threatCategory: result.threatCategory
            });
        }
    }

    /**
     * Get firewall analytics
     */
    static async getFirewallAnalytics(
        userId?: string,
        dateRange?: { start: Date; end: Date }
    ): Promise<FirewallAnalytics> {
        try {
            const { ThreatLog } = await import('../models/ThreatLog');
            
            const matchQuery: any = {};
            
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
                        totalRequests: { $sum: 1 },
                        blockedRequests: { $sum: 1 }, // All logs are blocked requests
                        costSaved: { $sum: '$costSaved' },
                        threatsByCategory: {
                            $push: '$threatCategory'
                        },
                        savingsByThreatType: {
                            $push: {
                                category: '$threatCategory',
                                cost: '$costSaved'
                            }
                        }
                    }
                }
            ]);

            if (analytics.length === 0) {
                return {
                    totalRequests: 0,
                    blockedRequests: 0,
                    costSaved: 0,
                    threatsByCategory: {},
                    savingsByThreatType: {}
                };
            }

            const result = analytics[0];
            
            // Count threats by category
            const threatsByCategory: Record<string, number> = {};
            result.threatsByCategory.forEach((category: string) => {
                threatsByCategory[category] = (threatsByCategory[category] || 0) + 1;
            });

            // Calculate savings by threat type
            const savingsByThreatType: Record<string, number> = {};
            result.savingsByThreatType.forEach((item: any) => {
                savingsByThreatType[item.category] = (savingsByThreatType[item.category] || 0) + item.cost;
            });

            return {
                totalRequests: result.totalRequests,
                blockedRequests: result.blockedRequests,
                costSaved: result.costSaved,
                threatsByCategory,
                savingsByThreatType
            };

        } catch (error) {
            logger.error('Error getting firewall analytics', error as Error, { userId });
            
            return {
                totalRequests: 0,
                blockedRequests: 0,
                costSaved: 0,
                threatsByCategory: {},
                savingsByThreatType: {}
            };
        }
    }

    /**
     * Get default firewall configuration
     */
    static getDefaultConfig(): FirewallConfig {
        return {
            enableBasicFirewall: true,
            enableAdvancedFirewall: false,
            promptGuardThreshold: 0.5, // 50% confidence threshold
            llamaGuardThreshold: 0.8   // 80% confidence threshold
        };
    }

    /**
     * Parse firewall configuration from headers
     */
    static parseConfigFromHeaders(headers: Record<string, string | undefined>): FirewallConfig {
        const config = this.getDefaultConfig();
        
        // Basic firewall
        if (headers['costkatana-firewall-enabled'] === 'true') {
            config.enableBasicFirewall = true;
        }
        
        // Advanced firewall
        if (headers['costkatana-firewall-advanced'] === 'true') {
            config.enableAdvancedFirewall = true;
            config.enableBasicFirewall = true; // Advanced requires basic
        }
        
        // Custom thresholds (optional)
        if (headers['costkatana-firewall-prompt-threshold']) {
            const threshold = parseFloat(headers['costkatana-firewall-prompt-threshold']);
            if (!isNaN(threshold) && threshold >= 0 && threshold <= 1) {
                config.promptGuardThreshold = threshold;
            }
        }
        
        if (headers['costkatana-firewall-llama-threshold']) {
            const threshold = parseFloat(headers['costkatana-firewall-llama-threshold']);
            if (!isNaN(threshold) && threshold >= 0 && threshold <= 1) {
                config.llamaGuardThreshold = threshold;
            }
        }
        
        return config;
    }
}