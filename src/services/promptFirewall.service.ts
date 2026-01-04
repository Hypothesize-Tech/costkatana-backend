import { loggingService } from './logging.service';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { retryBedrockOperation } from '../utils/bedrockRetry';
import { HTMLSecurityService } from './htmlSecurity.service';

export interface ThreatDetectionResult {
    isBlocked: boolean;
    threatCategory?: string;
    confidence: number;
    reason: string;
    stage: 'prompt-guard' | 'llama-guard' | 'rag-guard' | 'tool-guard';
    details?: any;
    matchedPatterns?: string[];
    riskScore?: number;
    containmentAction?: 'block' | 'sandbox' | 'human_review' | 'allow';
    provenanceSource?: string;
}

export interface FirewallConfig {
    enableBasicFirewall: boolean;
    enableAdvancedFirewall: boolean;
    enableRAGSecurity: boolean;
    enableToolSecurity: boolean;
    promptGuardThreshold: number; // 0.0 to 1.0
    llamaGuardThreshold: number; // 0.0 to 1.0
    ragSecurityThreshold: number; // 0.0 to 1.0
    toolSecurityThreshold: number; // 0.0 to 1.0
    sandboxHighRisk: boolean;
    requireHumanApproval: boolean;
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
    
    // Pre-compiled regex patterns for better performance
    private static readonly INJECTION_PATTERNS = [
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

    private static readonly JAILBREAK_PATTERNS = [
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

    private static readonly HARMFUL_PATTERNS = [
        /how\s+to\s+(?:make|build|create)\s+(?:a\s+)?bomb/i,
        /how\s+to\s+(?:hack|break\s+into)/i,
        /how\s+to\s+(?:steal|rob)/i,
        /suicide\s+methods/i,
        /self\s+harm/i,
        /illegal\s+drugs/i,
        /child\s+(?:abuse|exploitation)/i,
        /hate\s+speech/i,
        /terrorist/i,
        /violence\s+against/i,
        /(?:create|make|generate|produce).*harmful/i,
        /harmful\s+content/i,
        /(?:hurt|harm|damage|injure).*others/i,
        /(?:how|way|method).*hurt/i,
        /dangerous\s+content/i,
        /malicious\s+content/i
    ];

    // Circuit breaker for external services
    private static serviceFailureCount: number = 0;
    private static readonly MAX_SERVICE_FAILURES = 3;
    private static readonly CIRCUIT_BREAKER_RESET_TIME = 180000; // 3 minutes
    private static lastServiceFailureTime: number = 0;

    // Whitelisted integration patterns - these are legitimate platform commands
    private static readonly INTEGRATION_PATTERNS = [
        /@aws(?::|$|\s)/i,
        /@vercel(?::|$|\s)/i,
        /@github(?::|$|\s)/i,
        /@google(?::|$|\s)/i,
        /@jira(?::|$|\s)/i,
        /@linear(?::|$|\s)/i,
        /@slack(?::|$|\s)/i,
        /@discord(?::|$|\s)/i,
        /@drive(?::|$|\s)/i,
        /@sheets(?::|$|\s)/i,
        /@docs(?::|$|\s)/i,
        /@webhook(?::|$|\s)/i,
        /@calendar(?::|$|\s)/i,
        /@gmail(?::|$|\s)/i,
        /@forms(?::|$|\s)/i,
        /@slides(?::|$|\s)/i
    ];

    /**
     * Check if the prompt is a whitelisted integration command
     */
    private static isIntegrationCommand(prompt: string): boolean {
        for (const pattern of this.INTEGRATION_PATTERNS) {
            if (pattern.test(prompt)) {
                return true;
            }
        }
        return false;
    }
    
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
                loggingService.info('AWS Bedrock client initialized for firewall');
            } catch (error) {
                loggingService.warn('Failed to initialize AWS Bedrock client, using fallback firewall only', { error: (error as Error).message });
            }
        } else {
            loggingService.info('AWS credentials not configured, using pattern-matching firewall only');
        }
    }

    /**
     * Main firewall check - processes prompt through security layers
     * Now supports HTML content scanning
     */
    static async checkPrompt(
        prompt: string,
        config: FirewallConfig,
        requestId: string,
        estimatedCost: number = 0.01,
        context?: {
            retrievedChunks?: string[];
            toolCalls?: any[];
            userId?: string;
            provenanceSource?: string;
            ipAddress?: string;
            userAgent?: string;
            source?: string;
        }
    ): Promise<ThreatDetectionResult> {
        try {
            this.initialize();

            // WHITELIST: Allow integration mentions (@aws, @vercel, @github, etc.)
            // These are legitimate platform commands and should never be blocked
            if (this.isIntegrationCommand(prompt as string)) {
                loggingService.debug('Integration command detected - whitelisted', {
                    requestId,
                    promptPreview: prompt.substring(0, 100)
                });
                return {
                    isBlocked: false,
                    confidence: 0.0,
                    reason: 'Integration command - whitelisted',
                    stage: 'prompt-guard',
                    containmentAction: 'allow'
                };
            }

            // Pre-process: Extract text from HTML if present
            const preparedContent = HTMLSecurityService.prepareContentForScanning(prompt);
            const textToScan = preparedContent.textToScan;
            const isHTML = preparedContent.isHTML;

            // Log HTML detection
            if (isHTML) {
                loggingService.debug('HTML content detected, extracted text for scanning', {
                    requestId,
                    originalLength: prompt.length,
                    extractedLength: textToScan.length,
                    htmlMetadata: preparedContent.metadata
                });
            }

            // Stage 1: Basic Prompt Guard (Fast injection detection)
            if (config.enableBasicFirewall) {
                const promptGuardResult = await this.runPromptGuard(textToScan, config.promptGuardThreshold);
                
                if (promptGuardResult.isBlocked) {
                    // Add HTML metadata to result
                    if (isHTML) {
                        promptGuardResult.details = {
                            ...promptGuardResult.details,
                            htmlDetected: true,
                            htmlMetadata: preparedContent.metadata
                        };
                    }
                    await this.logThreatDetection(
                        requestId, 
                        promptGuardResult, 
                        estimatedCost, 
                        context?.userId, 
                        prompt,
                        {
                            ipAddress: context?.ipAddress,
                            userAgent: context?.userAgent,
                            source: context?.source
                        }
                    );
                    return promptGuardResult;
                }
            }

            // Stage 2: Advanced AI-based detection (Deep content analysis for all threat categories)
            if (config.enableAdvancedFirewall) {
                const aiDetectionResult = await this.runAIDetection(textToScan, config.llamaGuardThreshold, isHTML, preparedContent.metadata);
                
                // Log ALL threats detected by AI, even if confidence is below blocking threshold
                // This ensures compliance tracking and monitoring
                if (aiDetectionResult.threatCategory && aiDetectionResult.confidence > 0.3) {
                    await this.logThreatDetection(
                        requestId, 
                        aiDetectionResult, 
                        estimatedCost, 
                        context?.userId, 
                        prompt,
                        {
                            ipAddress: context?.ipAddress,
                            userAgent: context?.userAgent,
                            source: context?.source
                        }
                    );
                }
                
                if (aiDetectionResult.isBlocked) {
                    return aiDetectionResult;
                }
            }
            
            // Final fallback: Check for harmful content patterns even if advanced firewall is disabled
            // This ensures we catch threats even when AI detection is unavailable
            const fallbackCheck = this.fallbackContentCheck(textToScan);
            if (fallbackCheck.isBlocked) {
                await this.logThreatDetection(
                    requestId,
                    fallbackCheck,
                    estimatedCost,
                    context?.userId,
                    prompt,
                    {
                        ipAddress: context?.ipAddress,
                        userAgent: context?.userAgent,
                        source: context?.source
                    }
                );
                return fallbackCheck;
            }
            
            // Return safe result if no threats detected
            return {
                isBlocked: false,
                confidence: 0.0,
                reason: 'No threats detected',
                stage: config.enableAdvancedFirewall ? 'llama-guard' : 'prompt-guard',
                containmentAction: 'allow'
            };

            // If we reach here, prompt passed all checks
            return {
                isBlocked: false,
                confidence: 0.0,
                reason: 'Prompt passed all security checks',
                stage: config.enableAdvancedFirewall ? 'llama-guard' : 'prompt-guard'
            };

        } catch (error) {
            loggingService.error('Error in prompt firewall check', {
                error: error instanceof Error ? error.message : String(error),
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
     * Check prompt with HTML support (convenience method)
     */
    static async checkPromptWithHTML(
        content: string,
        config: FirewallConfig,
        requestId: string,
        estimatedCost: number = 0.01,
        context?: {
            retrievedChunks?: string[];
            toolCalls?: any[];
            userId?: string;
            provenanceSource?: string;
            ipAddress?: string;
            userAgent?: string;
            source?: string;
        }
    ): Promise<ThreatDetectionResult> {
        return this.checkPrompt(content, config, requestId, estimatedCost, context);
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

        if (useBedrockModels && !this.isServiceCircuitBreakerOpen()) {
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
                
                // Reset failure count on success
                this.serviceFailureCount = 0;
                
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
                this.recordServiceFailure();
                loggingService.warn('Bedrock Prompt Guard failed, using fallback', { value: error as Error });
            }
        }

        // Use pattern matching (always works)
        return this.fallbackPromptGuardCheck(prompt, threshold);
    }

    /**
     * Stage 2: AI-based Detection - Deep content analysis for all 15 threat categories
     * Uses Nova Pro or Claude via Bedrock for comprehensive threat detection
     */
    private static async runAIDetection(
        prompt: string,
        threshold: number,
        isHTML: boolean = false,
        htmlMetadata?: any
    ): Promise<ThreatDetectionResult> {
        this.initialize();
        const useBedrockModels = process.env.ENABLE_BEDROCK_FIREWALL === 'true' && this.bedrockClient;

        if (useBedrockModels && !this.isServiceCircuitBreakerOpen()) {
            try {
                // Use Nova Pro for fast, cost-effective detection (primary)
                // Fallback to Claude 3.5 Sonnet for complex cases
                const modelId = 'amazon.nova-pro-v1:0'; // Primary model
                
                const detectionPrompt = `Analyze the following content for security threats. Check for ALL of these threat categories:
1. Violence & Hate
2. Sexual Content
3. Self Harm
4. Prompt Injection
5. Jailbreak Attempt
6. Privacy Violations
7. Harmful Content
8. Criminal Planning
9. Guns & Illegal Weapons
10. Regulated Substances
11. Data Exfiltration
12. Phishing & Social Engineering
13. Spam and Unwanted Content
14. Misinformation
15. IP Violations
16. Harassment & Bullying

${isHTML ? 'NOTE: This content was extracted from HTML. Pay special attention to hidden or obfuscated threats.\n' : ''}

Content to analyze:
"${prompt.substring(0, 4000)}"

Respond with ONLY a JSON object in this exact format:
{
  "isThreat": boolean,
  "threatCategory": "category_name" or null,
  "confidence": 0.0-1.0,
  "reason": "brief explanation",
  "matchedPatterns": ["pattern1", "pattern2"]
}

JSON Response:`;

                const requestBody = {
                    messages: [
                        {
                            role: 'user',
                            content: [{ text: detectionPrompt }]
                        }
                    ],
                    inferenceConfig: {
                        max_new_tokens: 500,
                        temperature: 0.0,
                        top_p: 0.9
                    }
                };

                const input = {
                    modelId,
                    contentType: 'application/json',
                    accept: 'application/json',
                    body: JSON.stringify(requestBody)
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
                        modelId,
                        operation: 'aiThreatDetection'
                    }
                );
                
                const responseBody = JSON.parse(new TextDecoder().decode(response.body));
                // Nova Pro response format
                const responseText = responseBody.output?.message?.content?.[0]?.text || 
                                   responseBody.output?.text || 
                                   responseBody.content?.[0]?.text || 
                                   responseBody.text || 
                                   responseBody.generation || 
                                   '';
                
                // Parse JSON response
                let detectionResult: any = null;
                try {
                    // Extract JSON from response (might be wrapped in markdown code blocks)
                    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        detectionResult = JSON.parse(jsonMatch[0]);
                    }
                } catch (parseError) {
                    loggingService.warn('Failed to parse AI detection response, using fallback', {
                        error: parseError instanceof Error ? parseError.message : String(parseError),
                        responseText: responseText.substring(0, 200)
                    });
                }

                if (detectionResult && detectionResult.isThreat) {
                    // Reset failure count on success
                    this.serviceFailureCount = 0;
                    
                    // Normalize threat category to match ThreatLog enum
                    const normalizedCategory = this.normalizeThreatCategory(detectionResult.threatCategory || 'harmful_content');
                    
                    return {
                        isBlocked: true,
                        threatCategory: normalizedCategory,
                        confidence: detectionResult.confidence || 0.9,
                        reason: detectionResult.reason || 'AI detected security threat',
                        stage: 'llama-guard',
                        matchedPatterns: detectionResult.matchedPatterns || [],
                        riskScore: detectionResult.confidence || 0.9,
                        containmentAction: (detectionResult.confidence || 0.9) > 0.8 ? 'block' : 'sandbox',
                        details: {
                            method: 'ai_detection_nova_pro',
                            modelId,
                            isHTML,
                            htmlMetadata,
                            originalCategory: detectionResult.threatCategory
                        }
                    };
                }

                // Reset failure count on success
                this.serviceFailureCount = 0;
                
                return {
                    isBlocked: false,
                    confidence: detectionResult?.confidence || 0.1,
                    reason: 'No threats detected by AI analysis',
                    stage: 'llama-guard',
                    details: {
                        method: 'ai_detection_nova_pro',
                        modelId,
                        isHTML
                    }
                };

            } catch (error) {
                this.recordServiceFailure();
                loggingService.warn('AI detection failed, using fallback', { 
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }

        // Fallback to pattern matching
        return this.fallbackContentCheck(prompt);
    }


    /**
     * Optimized fallback prompt injection check using pre-compiled patterns
     */
    private static fallbackPromptGuardCheck(prompt: string, threshold: number): ThreatDetectionResult {
        let injectionScore = 0;
        let jailbreakScore = 0;
        const matchedPatterns: string[] = [];

        // Check for injection patterns using pre-compiled regex
        for (const pattern of this.INJECTION_PATTERNS) {
            if (pattern.test(prompt)) {
                injectionScore += 0.3;
                matchedPatterns.push(`injection:${pattern.source.substring(0, 50)}`);
            }
        }

        // Check for jailbreak patterns using pre-compiled regex
        for (const pattern of this.JAILBREAK_PATTERNS) {
            if (pattern.test(prompt)) {
                jailbreakScore += 0.3;
                matchedPatterns.push(`jailbreak:${pattern.source.substring(0, 50)}`);
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
                ? `Detected ${threatCategory} patterns (optimized check)`
                : 'No suspicious patterns detected',
            stage: 'prompt-guard',
            matchedPatterns,
            riskScore: maxScore,
            containmentAction: isBlocked ? (maxScore > 0.8 ? 'block' : 'sandbox') : 'allow',
            details: {
                injectionScore,
                jailbreakScore,
                threshold,
                method: 'optimized_pattern_matching',
                patternsMatched: matchedPatterns.length
            }
        };
    }

    /**
     * Optimized fallback content filtering using pre-compiled patterns
     */
    private static fallbackContentCheck(prompt: string): ThreatDetectionResult {
        const matchedPatterns: string[] = [];
        let maxConfidence = 0.1;

        for (const pattern of this.HARMFUL_PATTERNS) {
            if (pattern.test(prompt)) {
                matchedPatterns.push(`harmful:${pattern.source.substring(0, 50)}`);
                maxConfidence = 0.8;
                
                return {
                    isBlocked: true,
                    threatCategory: 'harmful_content',
                    confidence: maxConfidence,
                    reason: 'Content contains potentially harmful patterns (optimized check)',
                    stage: 'llama-guard',
                    matchedPatterns,
                    riskScore: maxConfidence,
                    containmentAction: 'block',
                    details: {
                        method: 'optimized_content_filtering',
                        patternsMatched: matchedPatterns.length
                    }
                };
            }
        }

        return {
            isBlocked: false,
            confidence: maxConfidence,
            reason: 'No harmful content detected (optimized check)',
            stage: 'llama-guard',
            containmentAction: 'allow',
            details: {
                method: 'optimized_content_filtering',
                patternsChecked: this.HARMFUL_PATTERNS.length
            }
        };
    }





    /**
     * Log threat detection for analytics and compliance
     */
    private static async logThreatDetection(
        requestId: string,
        result: ThreatDetectionResult,
        estimatedCost: number,
        userId?: string,
        originalPrompt?: string,
        metadata?: {
            ipAddress?: string;
            userAgent?: string;
            source?: string; // 'chat-api', 'gateway', 'ai-router', etc.
        }
    ): Promise<void> {
        try {
            // Import ThreatLog model dynamically to avoid circular dependencies
            const { ThreatLog } = await import('../models/ThreatLog');
            
            const threatLog = new ThreatLog({
                requestId,
                userId: userId ? new (await import('mongoose')).Types.ObjectId(userId) : undefined,
                threatCategory: result.threatCategory || 'harmful_content',
                confidence: result.confidence,
                stage: result.stage,
                reason: result.reason,
                details: {
                    ...result.details,
                    source: metadata?.source || 'unknown',
                    containmentAction: result.containmentAction,
                    matchedPatterns: result.matchedPatterns,
                    riskScore: result.riskScore
                },
                costSaved: estimatedCost,
                timestamp: new Date(),
                promptHash: originalPrompt ? this.hashPrompt(originalPrompt) : undefined,
                promptPreview: originalPrompt ? this.sanitizePromptForPreview(originalPrompt) : undefined,
                ipAddress: metadata?.ipAddress,
                userAgent: metadata?.userAgent
            });

            await threatLog.save();

            loggingService.info('Threat detected and logged to database', { value:  { 
                requestId,
                threatCategory: result.threatCategory,
                confidence: result.confidence,
                stage: result.stage,
                costSaved: estimatedCost,
                source: metadata?.source,
                userId
             } });

        } catch (error) {
            loggingService.error('Error logging threat detection', {
                error: error instanceof Error ? error.message : String(error),
                requestId,
                threatCategory: result.threatCategory
            });
        }
    }

    /**
     * Normalize threat category name to match ThreatLog enum
     */
    private static normalizeThreatCategory(category: string | null | undefined): string {
        if (!category) {
            return 'harmful_content';
        }

        const categoryMap: Record<string, string> = {
            'violence & hate': 'violence_and_hate',
            'violence_and_hate': 'violence_and_hate',
            'sexual content': 'sexual_content',
            'sexual_content': 'sexual_content',
            'self harm': 'self_harm',
            'self_harm': 'self_harm',
            'prompt injection': 'prompt_injection',
            'prompt_injection': 'prompt_injection',
            'jailbreak attempt': 'jailbreak_attempt',
            'jailbreak_attempt': 'jailbreak_attempt',
            'jailbreaking': 'jailbreak_attempt',
            'privacy violations': 'privacy_violations',
            'privacy_violations': 'privacy_violations',
            'harmful content': 'harmful_content',
            'harmful_content': 'harmful_content',
            'criminal planning': 'criminal_planning',
            'criminal_planning': 'criminal_planning',
            'guns & illegal weapons': 'guns_and_illegal_weapons',
            'guns_and_illegal_weapons': 'guns_and_illegal_weapons',
            'regulated substances': 'regulated_substances',
            'regulated_substances': 'regulated_substances',
            'data exfiltration': 'data_exfiltration',
            'data_exfiltration': 'data_exfiltration',
            'phishing & social engineering': 'phishing_and_social_engineering',
            'phishing_and_social_engineering': 'phishing_and_social_engineering',
            'spam and unwanted content': 'spam_and_unwanted_content',
            'spam_and_unwanted_content': 'spam_and_unwanted_content',
            'misinformation': 'misinformation',
            'ip violations': 'intellectual_property_violations',
            'intellectual property violations': 'intellectual_property_violations',
            'intellectual_property_violations': 'intellectual_property_violations',
            'harassment & bullying': 'harassment_and_bullying',
            'harassment_and_bullying': 'harassment_and_bullying'
        };

        const normalized = category.toLowerCase().trim();
        return categoryMap[normalized] || 'harmful_content';
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
            loggingService.error('Error getting firewall analytics', {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            
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
            enableAdvancedFirewall: true, // Enable AI-based detection by default for comprehensive threat detection
            enableRAGSecurity: true,
            enableToolSecurity: true,
            promptGuardThreshold: 0.5, // 50% confidence threshold
            llamaGuardThreshold: 0.8,   // 80% confidence threshold
            ragSecurityThreshold: 0.6,  // 60% confidence threshold for RAG threats
            toolSecurityThreshold: 0.7, // 70% confidence threshold for tool security
            sandboxHighRisk: true,       // Sandbox high-risk requests instead of blocking
            requireHumanApproval: false  // Require human approval for certain operations
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
        
        // RAG security
        if (headers['costkatana-firewall-rag'] === 'false') {
            config.enableRAGSecurity = false;
        }
        
        // Tool security
        if (headers['costkatana-firewall-tools'] === 'false') {
            config.enableToolSecurity = false;
        }
        
        // Sandboxing
        if (headers['costkatana-firewall-sandbox'] === 'false') {
            config.sandboxHighRisk = false;
        }
        
        // Human approval
        if (headers['costkatana-firewall-human-approval'] === 'true') {
            config.requireHumanApproval = true;
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
        
        if (headers['costkatana-firewall-rag-threshold']) {
            const threshold = parseFloat(headers['costkatana-firewall-rag-threshold']);
            if (!isNaN(threshold) && threshold >= 0 && threshold <= 1) {
                config.ragSecurityThreshold = threshold;
            }
        }
        
        if (headers['costkatana-firewall-tool-threshold']) {
            const threshold = parseFloat(headers['costkatana-firewall-tool-threshold']);
            if (!isNaN(threshold) && threshold >= 0 && threshold <= 1) {
                config.toolSecurityThreshold = threshold;
            }
        }
        
        return config;
    }

    /**
     * Hash prompt for privacy and deduplication
     */
    private static hashPrompt(prompt: string): string {
        const crypto = require('crypto');
        return crypto.createHash('sha256').update(prompt).digest('hex');
    }

    /**
     * Sanitize prompt for preview (remove sensitive info, limit length)
     */
    private static sanitizePromptForPreview(prompt: string): string {
        if (!prompt) return '';
        
        // Remove potential sensitive patterns
        let sanitized = prompt
            .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[CREDIT_CARD_REDACTED]')
            .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN_REDACTED]')
            .replace(/password\s*[:=]\s*\S+/gi, 'password:[REDACTED]')
            .replace(/api[_\s]?key\s*[:=]\s*\S+/gi, 'api_key:[REDACTED]')
            .replace(/token\s*[:=]\s*\S+/gi, 'token:[REDACTED]')
            .replace(/email\s*[:=]\s*\S+@\S+\.\S+/gi, 'email:[REDACTED]')
            .replace(/phone\s*[:=]\s*[\d\s\-\(\)]+/gi, 'phone:[REDACTED]');

        // Limit to 200 characters and add ellipsis if truncated
        if (sanitized.length > 200) {
            sanitized = sanitized.substring(0, 197) + '...';
        }

        return sanitized;
    }

    /**
     * Circuit breaker utilities for external services
     */
    private static isServiceCircuitBreakerOpen(): boolean {
        if (this.serviceFailureCount >= this.MAX_SERVICE_FAILURES) {
            const timeSinceLastFailure = Date.now() - this.lastServiceFailureTime;
            if (timeSinceLastFailure < this.CIRCUIT_BREAKER_RESET_TIME) {
                return true;
            } else {
                // Reset circuit breaker
                this.serviceFailureCount = 0;
                return false;
            }
        }
        return false;
    }

    private static recordServiceFailure(): void {
        this.serviceFailureCount++;
        this.lastServiceFailureTime = Date.now();
    }

}