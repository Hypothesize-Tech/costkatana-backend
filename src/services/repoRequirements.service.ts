import { GitHubService } from './github.service';
import { IGitHubConnection } from '../models';
import { loggingService } from './logging.service';
import axios from 'axios';

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
        try {
            const integrationPoints: IntegrationPoint[] = [];
            const token = connection.decryptToken();
            
            // Get repository structure to analyze potential integration points
            const { data: repoContents }: { data: any } = await axios.get(
                `https://api.github.com/repos/${owner}/${repo}/contents`,
                {
                    headers: {
                        'Authorization': `token ${token}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                }
            );

            // Analyze feature name to determine integration patterns
            const featureLower = feature.toLowerCase();
            const isApiFeature = featureLower.includes('api') || featureLower.includes('endpoint');
            const isUIFeature = featureLower.includes('ui') || featureLower.includes('component');
            const isServiceFeature = featureLower.includes('service') || featureLower.includes('logic');
            const isAuthFeature = featureLower.includes('auth') || featureLower.includes('login');
            const isDbFeature = featureLower.includes('db') || featureLower.includes('database') || featureLower.includes('model');

            // Common entry points with high confidence
            const commonEntryPoints = [
                { path: 'src/index.ts', reason: 'Main application entry point', confidence: 0.9 },
                { path: 'src/app.ts', reason: 'Application configuration', confidence: 0.8 },
                { path: 'src/main.ts', reason: 'Main entry point', confidence: 0.8 },
                { path: 'index.js', reason: 'Root entry point', confidence: 0.7 },
                { path: 'app.js', reason: 'Application entry point', confidence: 0.7 }
            ];

            // Check which entry points exist in the repository
            for (const entryPoint of commonEntryPoints) {
                const exists = repoContents.some((file: { name: string }) => 
                    file.name === entryPoint.path.split('/').pop()
                );
                if (exists) {
                    integrationPoints.push({
                        filePath: entryPoint.path,
                        reason: entryPoint.reason,
                        confidence: entryPoint.confidence
                    });
                }
            }

            // Feature-specific integration points
            if (isApiFeature) {
                integrationPoints.push(
                    { filePath: 'src/routes/index.ts', reason: 'API route registration', confidence: 0.9 },
                    { filePath: 'src/controllers/index.ts', reason: 'Controller registration', confidence: 0.8 },
                    { filePath: 'src/middleware/index.ts', reason: 'Middleware integration', confidence: 0.7 }
                );
            }

            if (isUIFeature) {
                integrationPoints.push(
                    { filePath: 'src/components/index.ts', reason: 'Component export', confidence: 0.9 },
                    { filePath: 'src/pages/index.ts', reason: 'Page routing', confidence: 0.8 },
                    { filePath: 'src/App.tsx', reason: 'Main app component', confidence: 0.8 }
                );
            }

            if (isServiceFeature) {
                integrationPoints.push(
                    { filePath: 'src/services/index.ts', reason: 'Service registration', confidence: 0.9 },
                    { filePath: 'src/utils/index.ts', reason: 'Utility function export', confidence: 0.7 }
                );
            }

            if (isAuthFeature) {
                integrationPoints.push(
                    { filePath: 'src/middleware/auth.ts', reason: 'Authentication middleware', confidence: 0.9 },
                    { filePath: 'src/config/passport.ts', reason: 'Passport configuration', confidence: 0.8 },
                    { filePath: 'src/routes/auth.ts', reason: 'Authentication routes', confidence: 0.8 }
                );
            }

            if (isDbFeature) {
                integrationPoints.push(
                    { filePath: 'src/models/index.ts', reason: 'Model registration', confidence: 0.9 },
                    { filePath: 'src/database/index.ts', reason: 'Database configuration', confidence: 0.8 },
                    { filePath: 'src/migrations/index.ts', reason: 'Migration registration', confidence: 0.7 }
                );
            }

            // Get more detailed file structure for deeper analysis
            try {
                const { data: srcContents }: { data: any } = await axios.get(
                    `https://api.github.com/repos/${owner}/${repo}/contents/src`,
                    {
                        headers: {
                            'Authorization': `token ${token}`,
                            'Accept': 'application/vnd.github.v3+json'
                        }
                    }
                );

                // Look for existing patterns in the codebase
                const hasRoutes = srcContents.some((file: { name: string }) => file.name === 'routes');
                const hasControllers = srcContents.some((file: { name: string }) => file.name === 'controllers');
                const hasServices = srcContents.some((file: { name: string }) => file.name === 'services');
                const hasModels = srcContents.some((file: { name: string }) => file.name === 'models');

                // Add integration points based on existing structure
                if (hasRoutes && !integrationPoints.some(p => p.filePath.includes('routes'))) {
                    integrationPoints.push({
                        filePath: 'src/routes/index.ts',
                        reason: 'Route registration based on existing structure',
                        confidence: 0.8
                    });
                }

                if (hasControllers && !integrationPoints.some(p => p.filePath.includes('controllers'))) {
                    integrationPoints.push({
                        filePath: 'src/controllers/index.ts',
                        reason: 'Controller registration based on existing structure',
                        confidence: 0.8
                    });
                }

                if (hasServices && !integrationPoints.some(p => p.filePath.includes('services'))) {
                    integrationPoints.push({
                        filePath: 'src/services/index.ts',
                        reason: 'Service registration based on existing structure',
                        confidence: 0.8
                    });
                }

                if (hasModels && !integrationPoints.some(p => p.filePath.includes('models'))) {
                    integrationPoints.push({
                        filePath: 'src/models/index.ts',
                        reason: 'Model registration based on existing structure',
                        confidence: 0.8
                    });
                }
            } catch (srcError) {
                // Src directory might not exist or be accessible, continue with basic analysis
            }

            // Remove duplicates and sort by confidence
            const uniquePoints = integrationPoints.filter((point, index, self) =>
                index === self.findIndex(p => p.filePath === point.filePath)
            );

            return uniquePoints.sort((a, b) => b.confidence - a.confidence);

        } catch (error) {
            loggingService.error('Error finding integration points:', {
                error: error instanceof Error ? error.message : String(error),
                owner,
                repo,
                feature
            });

            // Return fallback integration points
            return [
                {
                    filePath: 'src/index.ts',
                    reason: 'Main entry point (fallback)',
                    confidence: 0.6
                },
                {
                    filePath: 'src/app.ts',
                    reason: 'Application entry point (fallback)',
                    confidence: 0.5
                }
            ];
        }
    }
}

