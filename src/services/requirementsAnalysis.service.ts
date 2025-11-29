import { AIRouterService } from './aiRouter.service';
import { loggingService } from './logging.service';

export interface IntentAnalysis {
    intent: 'test' | 'scaffold' | 'refactor' | 'fix' | 'explain' | 'document' | 'other';
    scope: 'file' | 'function' | 'module' | 'repository';
    language?: string;
    constraints?: {
        maxLOC?: number;
        requireTests?: boolean;
        styleGuide?: string;
    };
    riskLevel: 'low' | 'medium' | 'high';
    acceptanceCriteria?: string[];
}

export interface RequirementsAnalysis {
    intent: IntentAnalysis;
    detectedLanguage?: string;
    generationType: 'test' | 'boilerplate' | 'refactor' | 'docs' | 'patch' | 'other';
    scope: IntentAnalysis['scope'];
    constraints: Record<string, unknown>;
    riskLevel: 'low' | 'medium' | 'high';
}

/**
 * Requirements analysis service for understanding user requests
 */
export class RequirementsAnalysisService {
    /**
     * Analyze user request to extract intent, scope, and constraints
     */
    static async analyzeRequest(
        userRequest: string,
        repoContext?: {
            languages?: string[];
            framework?: string;
            packageManager?: string;
        }
    ): Promise<RequirementsAnalysis> {
        try {
            const prompt = `Analyze this code generation request and extract requirements:

User Request: "${userRequest}"

${repoContext ? `Repository Context:
- Languages: ${repoContext.languages?.join(', ') || 'Unknown'}
- Framework: ${repoContext.framework || 'Unknown'}
- Package Manager: ${repoContext.packageManager || 'Unknown'}
` : ''}

Extract and return JSON with:
{
  "intent": "test" | "scaffold" | "refactor" | "fix" | "explain" | "document" | "other",
  "scope": "file" | "function" | "module" | "repository",
  "language": "detected language or null",
  "generationType": "test" | "boilerplate" | "refactor" | "docs" | "patch" | "other",
  "constraints": {
    "maxLOC": number or null,
    "requireTests": boolean,
    "styleGuide": string or null
  },
  "riskLevel": "low" | "medium" | "high",
  "acceptanceCriteria": ["criterion1", "criterion2"]
}

Risk level guidelines:
- low: tests, docs, simple refactors
- medium: new features, moderate refactors
- high: auth, security, infrastructure, large-scale changes

Return ONLY valid JSON, no markdown.`;

            const response = await AIRouterService.invokeModel(
                prompt,
                'amazon.nova-pro-v1:0'
            );

            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]) as Partial<RequirementsAnalysis> & { intent?: string | IntentAnalysis };
                
                // Normalize intent structure
                let intent: IntentAnalysis;
                if (typeof parsed.intent === 'string') {
                    const detectedIntent = parsed.intent as IntentAnalysis['intent'];
                    intent = {
                        intent: detectedIntent,
                        scope: parsed.scope || this.detectScopeFromKeywords(userRequest),
                        language: parsed.detectedLanguage,
                        riskLevel: parsed.riskLevel || this.detectRiskLevel(userRequest, detectedIntent)
                    };
                } else if (parsed.intent) {
                    intent = parsed.intent;
                } else {
                    const detectedIntent = this.detectIntentFromKeywords(userRequest);
                    intent = {
                        intent: detectedIntent,
                        scope: parsed.scope || this.detectScopeFromKeywords(userRequest),
                        language: parsed.detectedLanguage,
                        riskLevel: parsed.riskLevel || this.detectRiskLevel(userRequest, detectedIntent)
                    };
                }

                const analysis: RequirementsAnalysis = {
                    intent,
                    detectedLanguage: parsed.detectedLanguage,
                    generationType: parsed.generationType || this.mapIntentToGenerationType(intent.intent),
                    scope: intent.scope,
                    constraints: parsed.constraints || {},
                    riskLevel: intent.riskLevel
                };

                loggingService.info('Requirements analyzed', {
                    component: 'RequirementsAnalysisService',
                    intent: analysis.intent,
                    scope: analysis.scope,
                    riskLevel: analysis.riskLevel
                });

                return analysis;
            }
        } catch (error) {
            loggingService.warn('AI requirements analysis failed, using keyword detection', {
                component: 'RequirementsAnalysisService',
                error: error instanceof Error ? error.message : 'Unknown'
            });
        }

        // Fallback to keyword-based detection
        return this.analyzeWithKeywords(userRequest, repoContext);
    }

    /**
     * Fallback: analyze using keyword patterns
     */
    private static analyzeWithKeywords(
        userRequest: string,
        repoContext?: {
            languages?: string[];
            framework?: string;
            packageManager?: string;
        }
    ): RequirementsAnalysis {
        const lowerRequest = userRequest.toLowerCase();
        
        const intent = this.detectIntentFromKeywords(userRequest);
        const scope = this.detectScopeFromKeywords(userRequest);
        const language = repoContext?.languages?.[0] || this.detectLanguageFromKeywords(userRequest);
        const riskLevel = this.detectRiskLevel(userRequest, intent);

        return {
            intent: {
                intent,
                scope,
                language,
                riskLevel
            },
            detectedLanguage: language,
            generationType: this.mapIntentToGenerationType(intent),
            scope,
            constraints: {},
            riskLevel
        };
    }

    /**
     * Detect intent from keywords
     */
    private static detectIntentFromKeywords(request: string): IntentAnalysis['intent'] {
        const lower = request.toLowerCase();
        
        if (lower.includes('test') || lower.includes('spec')) {
            return 'test';
        }
        if (lower.includes('create') || lower.includes('add') || lower.includes('new') || lower.includes('scaffold')) {
            return 'scaffold';
        }
        if (lower.includes('refactor') || lower.includes('improve') || lower.includes('optimize')) {
            return 'refactor';
        }
        if (lower.includes('fix') || lower.includes('bug') || lower.includes('error')) {
            return 'fix';
        }
        if (lower.includes('explain') || lower.includes('how') || lower.includes('what')) {
            return 'explain';
        }
        if (lower.includes('document') || lower.includes('doc') || lower.includes('comment')) {
            return 'document';
        }
        
        return 'other';
    }

    /**
     * Detect scope from keywords
     */
    private static detectScopeFromKeywords(request: string): IntentAnalysis['scope'] {
        const lower = request.toLowerCase();
        
        if (lower.includes('function') || lower.includes('method')) {
            return 'function';
        }
        if (lower.includes('module') || lower.includes('package')) {
            return 'module';
        }
        if (lower.includes('repo') || lower.includes('repository') || lower.includes('project')) {
            return 'repository';
        }
        
        return 'file';
    }

    /**
     * Detect language from keywords
     */
    private static detectLanguageFromKeywords(request: string): string | undefined {
        const lower = request.toLowerCase();
        const languageKeywords: Record<string, string> = {
            'typescript': 'typescript',
            'ts': 'typescript',
            'javascript': 'javascript',
            'js': 'javascript',
            'python': 'python',
            'py': 'python',
            'java': 'java',
            'go': 'go',
            'rust': 'rust',
            'cpp': 'cpp',
            'c++': 'cpp'
        };

        for (const [keyword, lang] of Object.entries(languageKeywords)) {
            if (lower.includes(keyword)) {
                return lang;
            }
        }

        return undefined;
    }

    /**
     * Detect risk level
     */
    private static detectRiskLevel(request: string, intent: IntentAnalysis['intent']): 'low' | 'medium' | 'high' {
        const lower = request.toLowerCase();
        
        // High risk keywords
        if (lower.includes('auth') || lower.includes('security') || lower.includes('encrypt') ||
            lower.includes('password') || lower.includes('token') || lower.includes('key') ||
            lower.includes('infrastructure') || lower.includes('infra') || lower.includes('deploy')) {
            return 'high';
        }
        
        // Medium risk
        if (lower.includes('database') || lower.includes('api') || lower.includes('endpoint') ||
            intent === 'refactor' || intent === 'scaffold') {
            return 'medium';
        }
        
        // Low risk
        if (intent === 'test' || intent === 'document' || intent === 'explain') {
            return 'low';
        }
        
        return 'medium';
    }

    /**
     * Map intent to generation type
     */
    private static mapIntentToGenerationType(intent: IntentAnalysis['intent']): RequirementsAnalysis['generationType'] {
        switch (intent) {
            case 'test':
                return 'test';
            case 'scaffold':
                return 'boilerplate';
            case 'refactor':
                return 'refactor';
            case 'document':
            case 'explain':
                return 'docs';
            case 'fix':
                return 'patch';
            default:
                return 'other';
        }
    }
}

