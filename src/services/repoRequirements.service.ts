import { GitHubService } from './github.service';
import { IGitHubConnection } from '../models';
import { loggingService } from './logging.service';

export interface RepoActivity {
    mostChangedFiles: Array<{ path: string; changeCount: number }>;
    commonPRPatterns: string[];
    ciFailures: Array<{ pattern: string; frequency: number }>;
    repetitiveTasks: string[];
    languageDistribution: Record<string, number>;
}

export interface IntegrationPoint {
    filePath: string;
    reason: string;
    confidence: number;
}

/**
 * Repository requirements analysis service
 * Mines repo activity to identify repetitive tasks and integration points
 */
export class RepoRequirementsService {
    /**
     * Analyze repository for requirements and patterns
     */
    static async analyzeRepository(
        connection: IGitHubConnection & { decryptToken: () => string },
        owner: string,
        repo: string
    ): Promise<RepoActivity> {
        try {
            // Get repository files to analyze language distribution
            const files = await GitHubService.getAllRepositoryFiles(connection, owner, repo);
            
            // Calculate language distribution
            const languageDistribution: Record<string, number> = {};
            for (const file of files) {
                const ext = file.path.substring(file.path.lastIndexOf('.'));
                const language = this.getLanguageFromExtension(ext);
                if (language) {
                    languageDistribution[language] = (languageDistribution[language] || 0) + 1;
                }
            }

            // In production, would analyze:
            // - Git history for most changed files
            // - PR patterns from GitHub API
            // - CI failure logs
            // - Issue patterns

            return {
                mostChangedFiles: [], // Would be populated from git history
                commonPRPatterns: [], // Would be populated from PR analysis
                ciFailures: [], // Would be populated from CI logs
                repetitiveTasks: this.detectRepetitiveTasks(files),
                languageDistribution
            };
        } catch (error) {
            loggingService.error('Repository analysis failed', {
                component: 'RepoRequirementsService',
                repo: `${owner}/${repo}`,
                error: error instanceof Error ? error.message : 'Unknown'
            });
            throw error;
        }
    }

    /**
     * Detect repetitive tasks from file structure
     */
    private static detectRepetitiveTasks(files: Array<{ path: string }>): string[] {
        const tasks: string[] = [];
        const paths = files.map(f => f.path);

        // Detect test files (repetitive test creation)
        const testFiles = paths.filter(p => 
            p.includes('test') || p.includes('spec') || p.includes('__tests__')
        );
        if (testFiles.length > 5) {
            tasks.push('test_generation');
        }

        // Detect config files (repetitive config setup)
        const configFiles = paths.filter(p =>
            p.includes('config') || p.endsWith('.json') || p.endsWith('.yaml')
        );
        if (configFiles.length > 3) {
            tasks.push('config_management');
        }

        // Detect component files (repetitive component creation)
        const componentFiles = paths.filter(p =>
            p.includes('component') || p.includes('Component')
        );
        if (componentFiles.length > 5) {
            tasks.push('component_generation');
        }

        return tasks;
    }

    /**
     * Get language from file extension
     */
    private static getLanguageFromExtension(ext: string): string | null {
        const languageMap: Record<string, string> = {
            '.ts': 'typescript',
            '.tsx': 'typescript',
            '.js': 'javascript',
            '.jsx': 'javascript',
            '.py': 'python',
            '.java': 'java',
            '.go': 'go',
            '.rs': 'rust'
        };
        return languageMap[ext.toLowerCase()] || null;
    }

    /**
     * Find integration points for a feature
     */
    static async findIntegrationPoints(
        connection: IGitHubConnection & { decryptToken: () => string },
        owner: string,
        repo: string,
        feature: string
    ): Promise<IntegrationPoint[]> {
        // In production, would use AST analysis and pattern matching
        // For now, return common integration points
        return [
            {
                filePath: 'src/index.ts',
                reason: 'Main entry point',
                confidence: 0.8
            },
            {
                filePath: 'src/app.ts',
                reason: 'Application entry point',
                confidence: 0.7
            }
        ];
    }
}

