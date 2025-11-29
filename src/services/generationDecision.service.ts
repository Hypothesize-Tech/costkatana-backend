import { RequirementsAnalysis, RequirementsAnalysisService } from './requirementsAnalysis.service';
import { LanguagePrioritizerService } from './languagePrioritizer.service';
import { loggingService } from './logging.service';

export interface GenerationDecision {
    shouldGenerate: boolean;
    generationType: 'test' | 'boilerplate' | 'refactor' | 'docs' | 'patch' | 'other';
    scope: 'file' | 'function' | 'module' | 'repository';
    language: string;
    requiresApproval: boolean;
    estimatedLOC: number;
    conflicts: string[]; // Existing code conflicts
    prerequisites: string[]; // Required before generation
    templates?: string[]; // Recommended templates
    riskLevel: 'low' | 'medium' | 'high'; // Risk level from requirements analysis
}

export interface GenerationContext {
    userRequest: string;
    repoContext?: {
        languages?: string[];
        framework?: string;
        packageManager?: string;
        existingFiles?: string[];
    };
    existingCode?: Record<string, string>; // filePath -> content
}

/**
 * Generation decision service
 * Decides what code to generate based on intent and repo context
 */
export class GenerationDecisionService {
    /**
     * Make generation decision
     */
    static async makeDecision(
        context: GenerationContext
    ): Promise<GenerationDecision> {
        try {
            // Analyze requirements
            const requirements = await RequirementsAnalysisService.analyzeRequest(
                context.userRequest,
                context.repoContext
            );

            // Determine language
            const language = this.determineLanguage(requirements, context.repoContext);

            // Check for conflicts
            const conflicts = this.detectConflicts(context.userRequest, context.existingCode);

            // Determine if approval is required
            const requiresApproval = this.requiresApproval(requirements, context);

            // Estimate LOC
            const estimatedLOC = this.estimateLOC(requirements, context);

            // Check prerequisites
            const prerequisites = this.checkPrerequisites(requirements, context);

            // Select templates
            const templates = this.selectTemplates(requirements, language);

            const decision: GenerationDecision = {
                shouldGenerate: true, // Default to generating
                generationType: requirements.generationType,
                scope: requirements.scope as GenerationDecision['scope'],
                language,
                requiresApproval,
                estimatedLOC,
                conflicts,
                prerequisites,
                templates,
                riskLevel: requirements.riskLevel
            };

            loggingService.info('Generation decision made', {
                component: 'GenerationDecisionService',
                generationType: decision.generationType,
                scope: decision.scope,
                language: decision.language,
                requiresApproval: decision.requiresApproval
            });

            return decision;
        } catch (error) {
            loggingService.error('Generation decision failed', {
                component: 'GenerationDecisionService',
                error: error instanceof Error ? error.message : 'Unknown'
            });

            // Fallback decision
            return {
                shouldGenerate: false,
                generationType: 'other',
                scope: 'file',
                language: context.repoContext?.languages?.[0] ?? 'unknown',
                requiresApproval: true,
                estimatedLOC: 0,
                conflicts: [],
                prerequisites: [],
                riskLevel: 'high' // Default to high risk on error
            };
        }
    }

    /**
     * Determine target language
     */
    private static determineLanguage(
        requirements: RequirementsAnalysis,
        repoContext?: GenerationContext['repoContext']
    ): string {
        // Use detected language from requirements if available
        if (requirements.detectedLanguage) {
            return requirements.detectedLanguage;
        }

        // Use primary language from repo context
        if (repoContext?.languages && repoContext.languages.length > 0) {
            const prioritized = LanguagePrioritizerService.prioritizeLanguages(repoContext.languages);
            return prioritized.primaryLanguage;
        }

        return 'unknown';
    }

    /**
     * Detect conflicts with existing code
     */
    private static detectConflicts(
        userRequest: string,
        existingCode?: Record<string, string>
    ): string[] {
        const conflicts: string[] = [];

        if (!existingCode) {
            return conflicts;
        }

        const lowerRequest = userRequest.toLowerCase();

        // Check for duplicate function/class names
        for (const [filePath, content] of Object.entries(existingCode)) {
            // Simple heuristic: check if request mentions creating something that already exists
            if (lowerRequest.includes('create') || lowerRequest.includes('add')) {
                // Extract potential names from request
                const namePattern = /(?:create|add)\s+(?:a\s+)?(?:new\s+)?(?:function|class|method|component)\s+([A-Z][a-zA-Z0-9]*)/i;
                const match = userRequest.match(namePattern);
                
                if (match) {
                    const proposedName = match[1];
                    if (content.includes(proposedName)) {
                        conflicts.push(`Potential duplicate: ${proposedName} may already exist in ${filePath}`);
                    }
                }
            }
        }

        return conflicts;
    }

    /**
     * Determine if approval is required
     */
    private static requiresApproval(
        requirements: RequirementsAnalysis,
        context: GenerationContext
    ): boolean {
        // High risk always requires approval
        if (requirements.riskLevel === 'high') {
            return true;
        }

        // Large changes require approval
        const estimatedLOC = this.estimateLOC(requirements, context);
        if (estimatedLOC > 200) {
            return true;
        }

        // Auth/security related requires approval
        const lowerRequest = context.userRequest.toLowerCase();
        if (lowerRequest.includes('auth') || lowerRequest.includes('security') ||
            lowerRequest.includes('password') || lowerRequest.includes('token')) {
            return true;
        }

        return false;
    }

    /**
     * Estimate lines of code
     */
    private static estimateLOC(
        requirements: RequirementsAnalysis,
        context: GenerationContext
    ): number {
        // Rough estimates based on generation type
        const estimates: Record<string, number> = {
            'test': 50,
            'boilerplate': 100,
            'refactor': 150,
            'docs': 20,
            'patch': 80,
            'other': 100
        };

        const baseEstimate = estimates[requirements.generationType] || 100;

        // Adjust based on scope
        const scopeMultipliers: Record<string, number> = {
            'function': 0.3,
            'file': 1.0,
            'module': 3.0,
            'repository': 10.0
        };

        const multiplier = scopeMultipliers[requirements.scope] || 1.0;

        // Adjust based on existing code complexity
        let complexityMultiplier = 1.0;
        if (context.existingCode) {
            const totalExistingLines = Object.values(context.existingCode)
                .reduce((sum, content) => sum + content.split('\n').length, 0);
            
            // Larger codebases may require more integration code
            if (totalExistingLines > 10000) {
                complexityMultiplier = 1.3;
            } else if (totalExistingLines > 5000) {
                complexityMultiplier = 1.15;
            }
        }

        // Adjust based on repo context
        if (context.repoContext?.framework) {
            // Framework-specific code may require more boilerplate
            complexityMultiplier *= 1.1;
        }

        return Math.ceil(baseEstimate * multiplier * complexityMultiplier);
    }

    /**
     * Check prerequisites
     */
    private static checkPrerequisites(
        requirements: RequirementsAnalysis,
        context: GenerationContext
    ): string[] {
        const prerequisites: string[] = [];

        // Check if language is supported
        if (requirements.detectedLanguage) {
            if (!LanguagePrioritizerService.isLanguageSupported(requirements.detectedLanguage)) {
                prerequisites.push(`Language ${requirements.detectedLanguage} may not be fully supported`);
            }
        }

        // Check for required dependencies
        const lowerRequest = context.userRequest.toLowerCase();
        if (lowerRequest.includes('database') && !context.repoContext?.packageManager) {
            prerequisites.push('Database dependencies may need to be configured');
        }

        return prerequisites;
    }

    /**
     * Select appropriate templates
     */
    private static selectTemplates(
        requirements: RequirementsAnalysis,
        language: string
    ): string[] {
        const templates: string[] = [];

        // Template naming: {generationType}_{language}_{framework?}
        const baseTemplate = `${requirements.generationType}_${language}`;
        templates.push(baseTemplate);

        // Add framework-specific templates if applicable
        // This would be enhanced with actual template library

        return templates;
    }
}

