import { loggingService } from './logging.service';

export interface LanguagePriority {
    language: string;
    priority: number; // 0-1, higher is better
    coverage: number; // Percentage of codebase
    toolingScore: number; // 0-1, quality of tooling
    teamProficiency: number; // 0-1, team skill level
}

export interface LanguagePrioritizationResult {
    primaryLanguage: string;
    secondaryLanguages: string[];
    prioritized: LanguagePriority[];
}

/**
 * Language prioritization service
 * Determines which languages to prioritize for code generation
 */
export class LanguagePrioritizerService {
    // Tooling quality scores (linters, type checkers, test runners)
    private static readonly TOOLING_SCORES: Record<string, number> = {
        'typescript': 0.95,
        'javascript': 0.85,
        'python': 0.90,
        'java': 0.88,
        'go': 0.87,
        'rust': 0.85,
        'cpp': 0.80,
        'c': 0.75,
        'ruby': 0.82,
        'php': 0.78,
        'swift': 0.85,
        'kotlin': 0.83
    };

    /**
     * Prioritize languages based on repo analysis
     */
    static prioritizeLanguages(
        languages: string[],
        languageDistribution?: Record<string, number>, // File counts per language
        teamProficiencies?: Record<string, number> // 0-1 scores per language
    ): LanguagePrioritizationResult {
        if (languages.length === 0) {
            return {
                primaryLanguage: 'unknown',
                secondaryLanguages: [],
                prioritized: []
            };
        }

        // Calculate priorities
        const priorities: LanguagePriority[] = languages.map(lang => {
            const normalizedLang = lang.toLowerCase();
            const coverage = languageDistribution
                ? (languageDistribution[normalizedLang] || 0) / Object.values(languageDistribution).reduce((a, b) => a + b, 0)
                : 1 / languages.length; // Equal if no distribution

            const toolingScore = this.TOOLING_SCORES[normalizedLang] || 0.70;
            const teamProficiency = teamProficiencies?.[normalizedLang] || 0.75; // Default assumption

            // Weighted priority: 40% coverage, 30% tooling, 30% proficiency
            const priority = (coverage * 0.4) + (toolingScore * 0.3) + (teamProficiency * 0.3);

            return {
                language: normalizedLang,
                priority,
                coverage,
                toolingScore,
                teamProficiency
            };
        });

        // Sort by priority
        priorities.sort((a, b) => b.priority - a.priority);

        const primaryLanguage = priorities[0]?.language || languages[0];
        const secondaryLanguages = priorities.slice(1, 4).map(p => p.language);

        loggingService.info('Languages prioritized', {
            component: 'LanguagePrioritizerService',
            primaryLanguage,
            secondaryLanguages,
            totalLanguages: languages.length
        });

        return {
            primaryLanguage,
            secondaryLanguages,
            prioritized: priorities
        };
    }

    /**
     * Detect primary language from file extensions
     */
    static detectPrimaryLanguage(fileExtensions: string[]): string {
        const extensionMap: Record<string, string> = {
            '.ts': 'typescript',
            '.tsx': 'typescript',
            '.js': 'javascript',
            '.jsx': 'javascript',
            '.py': 'python',
            '.java': 'java',
            '.go': 'go',
            '.rs': 'rust',
            '.cpp': 'cpp',
            '.cxx': 'cpp',
            '.cc': 'cpp',
            '.c': 'c',
            '.h': 'c',
            '.hpp': 'cpp',
            '.rb': 'ruby',
            '.php': 'php',
            '.swift': 'swift',
            '.kt': 'kotlin'
        };

        const languageCounts: Record<string, number> = {};

        for (const ext of fileExtensions) {
            const lang = extensionMap[ext.toLowerCase()];
            if (lang) {
                languageCounts[lang] = (languageCounts[lang] || 0) + 1;
            }
        }

        if (Object.keys(languageCounts).length === 0) {
            return 'unknown';
        }

        // Return most common language
        return Object.entries(languageCounts)
            .sort((a, b) => b[1] - a[1])[0][0];
    }

    /**
     * Check if language is supported for code generation
     */
    static isLanguageSupported(language: string): boolean {
        const normalized = language.toLowerCase();
        return normalized in this.TOOLING_SCORES;
    }

    /**
     * Get recommended languages for multi-language repos
     */
    static getRecommendedLanguages(
        languages: string[],
        maxRecommendations: number = 3
    ): string[] {
        const prioritized = this.prioritizeLanguages(languages);
        return [
            prioritized.primaryLanguage,
            ...prioritized.secondaryLanguages
        ].slice(0, maxRecommendations).filter(lang => lang !== 'unknown');
    }
}

