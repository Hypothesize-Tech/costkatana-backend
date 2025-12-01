import { AIRouterService } from './aiRouter.service';
import { loggingService } from './logging.service';

/**
 * Variable resolution result with confidence scoring
 */
export interface VariableResolutionResult {
    variableName: string;
    value: string;
    confidence: number; // 0-1 scale
    source: 'user_provided' | 'context_inferred' | 'default' | 'missing';
    reasoning?: string;
}

/**
 * Context for variable resolution
 */
export interface ResolutionContext {
    conversationHistory: Array<{
        role: 'user' | 'assistant';
        content: string;
    }>;
    userProvidedVariables?: Record<string, any>;
    templateVariables: Array<{
        name: string;
        description?: string;
        defaultValue?: string;
        required: boolean;
    }>;
}

/**
 * Service for intelligent variable resolution from conversation context
 * Uses lightweight AI to extract variable values from conversation history
 */
export class TemplateContextResolverService {
    private static variableCache = new Map<string, { value: string; timestamp: number }>();
    private static readonly CACHE_TTL = 300000; // 5 minutes

    /**
     * Resolve template variables using conversation context and AI inference
     */
    static async resolveVariables(context: ResolutionContext): Promise<{
        resolvedVariables: Record<string, any>;
        resolutionDetails: VariableResolutionResult[];
        allRequiredProvided: boolean;
    }> {
        const resolutionDetails: VariableResolutionResult[] = [];
        const resolvedVariables: Record<string, any> = {};
        let allRequiredProvided = true;

        try {
            // Ensure templateVariables is an array
            const templateVariables = context.templateVariables || [];
            
            loggingService.info('Starting template variable resolution', {
                variablesCount: templateVariables.length,
                historyLength: context.conversationHistory?.length || 0,
                providedVariables: Object.keys(context.userProvidedVariables || {})
            });

            // Process each template variable
            for (const templateVar of templateVariables) {
                let resolution: VariableResolutionResult;

                // Priority 1: User-provided variables
                if (context.userProvidedVariables && context.userProvidedVariables[templateVar.name] !== undefined) {
                    resolution = {
                        variableName: templateVar.name,
                        value: String(context.userProvidedVariables[templateVar.name]),
                        confidence: 1.0,
                        source: 'user_provided',
                        reasoning: 'Directly provided by user'
                    };
                }
                // Priority 2: Context inference using AI
                else if (context.conversationHistory && context.conversationHistory.length > 0) {
                    resolution = await this.inferVariableFromContext(
                        templateVar,
                        context.conversationHistory
                    );
                }
                // Priority 3: Default value
                else if (templateVar.defaultValue) {
                    resolution = {
                        variableName: templateVar.name,
                        value: templateVar.defaultValue,
                        confidence: 0.5,
                        source: 'default',
                        reasoning: 'Using template default value'
                    };
                }
                // Priority 4: Missing required variable
                else {
                    resolution = {
                        variableName: templateVar.name,
                        value: '',
                        confidence: 0,
                        source: 'missing',
                        reasoning: templateVar.required 
                            ? 'Required variable not provided and could not be inferred' 
                            : 'Optional variable not provided'
                    };
                    
                    if (templateVar.required) {
                        allRequiredProvided = false;
                    }
                }

                resolutionDetails.push(resolution);
                resolvedVariables[templateVar.name] = resolution.value;
            }

            loggingService.info('Template variable resolution completed', {
                totalVariables: resolutionDetails.length,
                userProvided: resolutionDetails.filter(r => r.source === 'user_provided').length,
                contextInferred: resolutionDetails.filter(r => r.source === 'context_inferred').length,
                defaults: resolutionDetails.filter(r => r.source === 'default').length,
                missing: resolutionDetails.filter(r => r.source === 'missing').length,
                allRequiredProvided
            });

            return {
                resolvedVariables,
                resolutionDetails,
                allRequiredProvided
            };

        } catch (error) {
            loggingService.error('Error resolving template variables', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Use AI to infer variable value from conversation history
     */
    private static async inferVariableFromContext(
        templateVar: { name: string; description?: string; defaultValue?: string; required: boolean },
        conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
    ): Promise<VariableResolutionResult> {
        try {
            // Check cache first
            const cacheKey = `${templateVar.name}_${conversationHistory.slice(-3).map(m => m.content).join('_')}`;
            const cached = this.variableCache.get(cacheKey);
            
            if (cached && (Date.now() - cached.timestamp < this.CACHE_TTL)) {
                loggingService.info('Using cached variable resolution', { variableName: templateVar.name });
                return {
                    variableName: templateVar.name,
                    value: cached.value,
                    confidence: 0.8,
                    source: 'context_inferred',
                    reasoning: 'Extracted from recent conversation (cached)'
                };
            }

            // Build context summary from recent messages
            const contextSummary = conversationHistory
                .slice(-5) // Last 5 messages
                .map(msg => `${msg.role}: ${msg.content}`)
                .join('\n');

            // Build AI prompt for variable extraction
            const extractionPrompt = `You are a helpful assistant that extracts specific information from conversation history.

Conversation History:
${contextSummary}

Task: Extract the value for the variable "${templateVar.name}"${templateVar.description ? ` (${templateVar.description})` : ''}.

Rules:
1. If the information is clearly present in the conversation, extract it exactly
2. If the information can be reasonably inferred, provide your best inference
3. If the information is not available, respond with "NOT_FOUND"
4. Return ONLY the extracted value, nothing else
5. Be concise and specific

Variable to extract: ${templateVar.name}${templateVar.description ? ` - ${templateVar.description}` : ''}

Extracted value:`;

            // Use Nova Micro for fast, cost-effective extraction
            const response = await AIRouterService.invokeModel(
                extractionPrompt,
                'amazon.nova-micro-v1:0',
                undefined, // userId - not needed for template extraction
                {
                    recentMessages: conversationHistory.slice(-3).map(msg => ({
                        role: msg.role,
                        content: msg.content
                    })),
                    useSystemPrompt: false
                }
            );

            const extractedValue = response.trim();

            // Check if AI found the value
            if (extractedValue === 'NOT_FOUND' || extractedValue === '' || extractedValue.toLowerCase().includes('not found')) {
                // Fall back to default or mark as missing
                if (templateVar.defaultValue) {
                    return {
                        variableName: templateVar.name,
                        value: templateVar.defaultValue,
                        confidence: 0.5,
                        source: 'default',
                        reasoning: 'Could not infer from context, using default'
                    };
                } else {
                    return {
                        variableName: templateVar.name,
                        value: '',
                        confidence: 0,
                        source: 'missing',
                        reasoning: 'Could not find or infer from conversation context'
                    };
                }
            }

            // Calculate confidence based on extraction quality
            const confidence = this.calculateConfidence(extractedValue, contextSummary);

            // Cache the result
            this.variableCache.set(cacheKey, { value: extractedValue, timestamp: Date.now() });

            return {
                variableName: templateVar.name,
                value: extractedValue,
                confidence,
                source: 'context_inferred',
                reasoning: 'Extracted from recent conversation using AI'
            };

        } catch (error) {
            loggingService.warn('Failed to infer variable from context', {
                variableName: templateVar.name,
                error: error instanceof Error ? error.message : String(error)
            });

            // Fall back to default or mark as missing
            if (templateVar.defaultValue) {
                return {
                    variableName: templateVar.name,
                    value: templateVar.defaultValue,
                    confidence: 0.5,
                    source: 'default',
                    reasoning: 'AI inference failed, using default'
                };
            } else {
                return {
                    variableName: templateVar.name,
                    value: '',
                    confidence: 0,
                    source: 'missing',
                    reasoning: 'AI inference failed and no default available'
                };
            }
        }
    }

    /**
     * Calculate confidence score for extracted value
     */
    private static calculateConfidence(extractedValue: string, context: string): number {
        // Base confidence
        let confidence = 0.7;

        // Increase confidence if value appears in context
        if (context.toLowerCase().includes(extractedValue.toLowerCase())) {
            confidence += 0.2;
        }

        // Decrease confidence for very short or very long values
        if (extractedValue.length < 3) {
            confidence -= 0.1;
        } else if (extractedValue.length > 100) {
            confidence -= 0.1;
        }

        // Increase confidence for specific patterns
        if (/^\d+$/.test(extractedValue)) { // Numbers
            confidence += 0.1;
        } else if (/^[A-Z][a-z]+(\s[A-Z][a-z]+)*$/.test(extractedValue)) { // Proper names
            confidence += 0.1;
        }

        // Clamp between 0.3 and 0.95
        return Math.max(0.3, Math.min(0.95, confidence));
    }

    /**
     * Clear variable cache (useful for testing or memory management)
     */
    static clearCache(): void {
        this.variableCache.clear();
        loggingService.info('Template variable cache cleared');
    }

    /**
     * Get cache statistics
     */
    static getCacheStats(): { size: number; entries: number } {
        return {
            size: this.variableCache.size,
            entries: Array.from(this.variableCache.values()).length
        };
    }
}

