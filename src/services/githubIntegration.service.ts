import { GitHubService } from './github.service';
import { GitHubAnalysisService, AnalysisResult } from './githubAnalysis.service';
import { GitHubCodeGeneratorService, IntegrationCode } from './githubCodeGenerator.service';
import { GitHubConnection, GitHubIntegration, IGitHubIntegration, IFeatureConfig } from '../models';
import { loggingService } from './logging.service';
import { Types } from 'mongoose';

export interface StartIntegrationOptions {
    userId: string;
    connectionId: string;
    repositoryId: number;
    repositoryName: string;
    repositoryFullName: string;
    integrationType: 'npm' | 'cli' | 'python';
    selectedFeatures: IFeatureConfig[];
    conversationId?: string;
}

export interface IntegrationProgress {
    integrationId: string;
    status: string;
    progress: number;
    currentStep: string;
    analysis?: AnalysisResult;
    prUrl?: string;
    errorMessage?: string;
}

export class GitHubIntegrationService {
    /**
     * Start a new GitHub integration
     */
    static async startIntegration(options: StartIntegrationOptions): Promise<IGitHubIntegration> {
        const {
            userId,
            connectionId,
            repositoryId,
            repositoryName,
            repositoryFullName,
            integrationType,
            selectedFeatures,
            conversationId
        } = options;

        try {
            loggingService.info('Starting GitHub integration', {
                userId,
                repository: repositoryFullName,
                integrationType,
                features: selectedFeatures.map(f => f.name)
            });

            // Create integration record
            const branchName = `costkatana-integration-${Date.now()}`;
            const integration = await GitHubIntegration.create({
                userId,
                connectionId: new Types.ObjectId(connectionId),
                repositoryId,
                repositoryName,
                repositoryFullName,
                branchName,
                status: 'initializing',
                integrationType,
                selectedFeatures,
                conversationId: conversationId ? new Types.ObjectId(conversationId) : undefined,
                commits: [],
                aiSuggestions: []
            });

            // Start async integration process
            this.processIntegration(integration._id.toString()).catch(error => {
                loggingService.error('Integration process failed', {
                    integrationId: integration._id.toString(),
                    error: error.message
                });
            });

            return integration;
        } catch (error: any) {
            loggingService.error('Failed to start integration', {
                userId,
                repository: repositoryFullName,
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Process integration asynchronously
     */
    private static async processIntegration(integrationId: string): Promise<void> {
        let integration: IGitHubIntegration | null = null;

        try {
            integration = await GitHubIntegration.findById(integrationId).populate('connectionId');
            if (!integration) {
                throw new Error('Integration not found');
            }

            const connection = await GitHubConnection.findById(integration.connectionId).select('+accessToken');
            if (!connection) {
                throw new Error('GitHub connection not found');
            }

            if (!integration.repositoryFullName) {
                throw new Error('Repository full name is not defined');
            }
            
            const [owner, repo] = integration.repositoryFullName.split('/');

            // Step 1: Analyze repository
            integration.status = 'analyzing';
            await integration.save();

            const analysis = await GitHubAnalysisService.analyzeRepository(connection, owner, repo);
            integration.analysisResults = analysis;
            await integration.save();

            loggingService.info('Repository analysis completed', {
                integrationId,
                language: analysis.language,
                framework: analysis.framework
            });

            // Step 2: Generate integration code
            integration.status = 'generating';
            await integration.save();

            const generatedCode = await GitHubCodeGeneratorService.generateIntegrationCode(
                integration.userId,
                {
                    integrationType: integration.integrationType,
                    features: integration.selectedFeatures,
                    analysis,
                    repositoryName: integration.repositoryName,
                    apiKey: process.env.COSTKATANA_DEFAULT_API_KEY || 'dak_your_key_here'
                }
            );

            loggingService.info('Code generation completed', {
                integrationId,
                filesCount: generatedCode.files.length
            });

            // Step 3: Create branch and commit files
            integration.status = 'draft';
            await integration.save();

            // Get default branch
            const repoData = await GitHubService.getRepository(connection, owner, repo);
            const defaultBranch = repoData.default_branch || 'main';

            // Create feature branch
            try {
                await GitHubService.createBranch(connection, {
                    owner,
                    repo,
                    branchName: integration.branchName,
                    fromBranch: defaultBranch
                });
            } catch (branchError: any) {
                if (branchError.message.includes('Resource not accessible by integration')) {
                    integration.status = 'permission_error';
                    integration.errorMessage = 'GitHub App permissions insufficient. Please update app permissions to include Contents: Write and reinstall the app.';
                    await integration.save();
                    
                    loggingService.error('GitHub App permissions insufficient', {
                        integrationId,
                        repository: integration.repositoryFullName,
                        error: branchError.message
                    });
                    
                    return; // Exit early
                }
                throw branchError; // Re-throw other errors
            }

            loggingService.info('Created feature branch', {
                integrationId,
                branchName: integration.branchName
            });

            // Commit generated files
            for (const file of generatedCode.files) {
                const result = await GitHubService.createOrUpdateFile(connection, {
                    owner,
                    repo,
                    branch: integration.branchName,
                    path: file.path,
                    content: file.content,
                    message: `feat: Add CostKatana integration - ${file.description}`
                });

                integration.commits.push({
                    sha: result.commit,
                    message: `Add ${file.path}`,
                    timestamp: new Date()
                });
            }

            await integration.save();

            loggingService.info('Files committed to branch', {
                integrationId,
                filesCount: generatedCode.files.length
            });

            // Step 4: Create pull request
            const prTitle = `🔧 Add CostKatana AI Cost Optimization Integration`;
            const prBody = this.generatePRDescription(
                integration.integrationType,
                integration.selectedFeatures,
                analysis,
                generatedCode
            );

            const pr = await GitHubService.createPullRequest(connection, {
                owner,
                repo,
                title: prTitle,
                body: prBody,
                head: integration.branchName,
                base: defaultBranch,
                draft: false
            });

            integration.prNumber = pr.number;
            integration.prUrl = pr.html_url;
            integration.prTitle = prTitle;
            integration.prDescription = prBody;
            integration.status = 'open';
            await integration.save();

            loggingService.info('Pull request created', {
                integrationId,
                prNumber: pr.number,
                prUrl: pr.html_url
            });

        } catch (error: any) {
            loggingService.error('Integration processing failed', {
                integrationId,
                error: error.message,
                stack: error.stack
            });

            if (integration) {
                integration.status = 'failed';
                integration.errorMessage = error.message;
                integration.errorStack = error.stack;
                await integration.save();
            }

            throw error;
        }
    }

    /**
     * Generate PR description
     */
    private static generatePRDescription(
        integrationType: string,
        features: IFeatureConfig[],
        analysis: AnalysisResult,
        code: IntegrationCode
    ): string {
        const packageName = integrationType === 'npm' ? 'cost-katana' :
                          integrationType === 'cli' ? 'cost-katana-cli' :
                          'cost-katana';

        return `## 🚀 CostKatana Integration

This PR adds [CostKatana](https://costkatana.com) AI cost optimization to your project!

### 📊 Repository Analysis
- **Language**: ${analysis.language}
- **Framework**: ${analysis.framework || 'None detected'}
- **Project Type**: ${analysis.projectType}
- **Existing AI Integrations**: ${analysis.existingAIIntegrations.join(', ') || 'None'}

### ✨ Integration Type
**${integrationType.toUpperCase()}** - Using \`${packageName}\` package

### 🎯 Features Enabled
${features.map(f => `- ✅ ${f.name}`).join('\n')}

### 📁 Files Added/Modified
${code.files.map(f => `- \`${f.path}\` - ${f.description}`).join('\n')}

### 🔧 Setup Instructions

${code.setupInstructions}

### 📦 Installation

\`\`\`bash
${code.installCommands.join('\n')}
\`\`\`

### 🔑 Environment Variables

Add these to your \`.env\` file:

\`\`\`env
${Object.entries(code.envVars).map(([key, value]) => `${key}=${value}`).join('\n')}
\`\`\`

### ✅ Testing Steps

${code.testingSteps.map((step, i) => `${i + 1}. ${step}`).join('\n')}

### 📚 Documentation

- [CostKatana Documentation](https://docs.costkatana.com)
- [Integration Guide](https://docs.costkatana.com/integration)
- [Feature Reference](https://docs.costkatana.com/features)

### 🤝 Need Help?

- 📧 Email: support@costkatana.com
- 💬 Discord: [Join our community](https://discord.gg/D8nDArmKbY)
- 📖 Docs: [docs.costkatana.com](https://docs.costkatana.com)

---

🤖 This PR was automatically generated by CostKatana's GitHub integration assistant.
`;
    }

    /**
     * Get integration status
     */
    static async getIntegrationStatus(integrationId: string): Promise<IntegrationProgress> {
        const integration = await GitHubIntegration.findById(integrationId);
        if (!integration) {
            throw new Error('Integration not found');
        }

        const statusMap: Record<string, number> = {
            'initializing': 10,
            'analyzing': 30,
            'generating': 60,
            'draft': 80,
            'open': 100,
            'updating': 70,
            'merged': 100,
            'closed': 100,
            'failed': 0,
            'permission_error': 0
        };

        return {
            integrationId: integration._id.toString(),
            status: integration.status,
            progress: statusMap[integration.status] || 0,
            currentStep: this.getStepDescription(integration.status),
            analysis: integration.analysisResults,
            prUrl: integration.prUrl,
            errorMessage: integration.errorMessage
        };
    }

    /**
     * Update integration via chat
     */
    static async updateIntegrationFromChat(
        integrationId: string,
        changes: string
    ): Promise<void> {
        const integration = await GitHubIntegration.findById(integrationId).populate('connectionId');
        if (!integration) {
            throw new Error('Integration not found');
        }

        const connection = await GitHubConnection.findById(integration.connectionId).select('+accessToken');
        if (!connection) {
            throw new Error('GitHub connection not found');
        }

        integration.status = 'updating';
        await integration.save();

        // TODO: Implement change parsing and application
        // For now, just log the change request
        loggingService.info('Integration update requested', {
            integrationId,
            changes
        });

        integration.status = 'open';
        await integration.save();
    }

    /**
     * List user integrations
     */
    static async listUserIntegrations(
        userId: string,
        options?: { status?: string; limit?: number }
    ): Promise<IGitHubIntegration[]> {
        const query: any = { userId };
        if (options?.status) {
            query.status = options.status;
        }

        return GitHubIntegration.find(query)
            .sort({ createdAt: -1 })
            .limit(options?.limit || 50)
            .exec();
    }

    /**
     * Get step description
     */
    private static getStepDescription(status: string): string {
        const descriptions: Record<string, string> = {
            'initializing': 'Initializing integration...',
            'analyzing': 'Analyzing repository structure...',
            'generating': 'Generating integration code...',
            'draft': 'Creating feature branch and committing files...',
            'open': 'Pull request created successfully!',
            'updating': 'Updating pull request with changes...',
            'merged': 'Integration merged successfully!',
            'closed': 'Pull request closed',
            'failed': 'Integration failed',
            'permission_error': 'GitHub App permissions need to be updated'
        };

        return descriptions[status] || 'Processing...';
    }
}

export default GitHubIntegrationService;



