import { GitHubService } from './github.service';
import { GitHubAnalysisService, AnalysisResult } from './githubAnalysis.service';
import { GitHubCodeGeneratorService, IntegrationCode } from './githubCodeGenerator.service';
import { AIRouterService } from './aiRouter.service';
import { GitHubConnection, GitHubIntegration, IGitHubIntegration, IFeatureConfig, IGitHubConnection, RepositoryUserMapping } from '../models';
import { User } from '../models';
import { loggingService } from './logging.service';
import { Types } from 'mongoose';

export interface StartIntegrationOptions {
    userId: string;
    connectionId: string;
    repositoryId: number;
    repositoryName: string;
    repositoryFullName: string;
    integrationType: 'npm' | 'cli' | 'python' | 'http-headers';
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

            // Create or update repository-to-user mapping for webhook events
            try {
                await RepositoryUserMapping.findOneAndUpdate(
                    { repositoryFullName },
                    {
                        userId,
                        connectionId: connectionId.toString(),
                        repositoryFullName
                    },
                    { upsert: true, new: true }
                );
                
                loggingService.info('Repository-user mapping created/updated', {
                    repositoryFullName,
                    userId
                });
            } catch (mappingError: any) {
                loggingService.warn('Failed to create repository mapping (non-critical)', {
                    repositoryFullName,
                    error: mappingError.message
                });
            }

            // Start async integration process
            this.processIntegration(integration._id.toString()).catch(error => {
                loggingService.error('Integration process failed', {
                    integrationId: integration._id.toString(),
                    error: error.message,
                    stack: error.stack,
                    repository: repositoryFullName,
                    timestamp: new Date().toISOString()
                });
                
                // Make sure status is updated to failed if process crashes
                GitHubIntegration.findById(integration._id.toString()).then(integrationRecord => {
                    if (integrationRecord && integrationRecord.status !== 'failed' && integrationRecord.status !== 'open') {
                        integrationRecord.status = 'failed';
                        integrationRecord.errorMessage = `Integration process crashed: ${error.message}`;
                        integrationRecord.errorStack = error.stack;
                        integrationRecord.lastActivityAt = new Date();
                        return integrationRecord.save();
                    }
                    return null;
                }).catch(saveError => {
                    loggingService.error('Failed to update integration status after crash', {
                        integrationId: integration._id.toString(),
                        saveError: saveError.message
                    });
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
        let connection: (IGitHubConnection & { decryptToken: () => string }) | null = null;

        loggingService.info('processIntegration started', {
            integrationId,
            timestamp: new Date().toISOString()
        });

        try {
            integration = await GitHubIntegration.findById(integrationId).populate('connectionId');
            if (!integration) {
                throw new Error('Integration not found');
            }

            loggingService.info('Integration found, starting processing', {
                integrationId,
                status: integration.status,
                repository: integration.repositoryFullName,
                integrationType: integration.integrationType
            });

            connection = await GitHubConnection.findById(integration.connectionId).select('+accessToken');
            if (!connection) {
                throw new Error('GitHub connection not found');
            }

            // Check if token is expired
            if (connection.expiresAt && new Date() > connection.expiresAt) {
                integration.status = 'failed';
                integration.errorMessage = 'GitHub access token has expired. Please reconnect your GitHub account.';
                await integration.save();
                loggingService.error('GitHub token expired', {
                    integrationId,
                    userId: connection.userId,
                    expiresAt: connection.expiresAt
                });
                return;
            }

            // Validate connection is active
            if (!connection.isActive) {
                integration.status = 'failed';
                integration.errorMessage = 'GitHub connection is inactive. Please reconnect your GitHub account.';
                await integration.save();
                loggingService.error('GitHub connection inactive', {
                    integrationId,
                    userId: connection.userId
                });
                return;
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

            // Step 2: Fetch existing file contents for preservation
            integration.status = 'analyzing';
            integration.lastActivityAt = new Date();
            await integration.save();

            // Retrieve existing entry point content to preserve it
            const existingFileContents: Record<string, string> = {};
            for (const entryPoint of analysis.entryPoints.slice(0, 3)) { // Check up to 3 entry points
                try {
                    loggingService.info('Fetching existing file content for preservation', {
                        integrationId,
                        filePath: entryPoint
                    });
                    const content = await GitHubService.getFileContent(connection, owner, repo, entryPoint);
                    existingFileContents[entryPoint] = content;
                    loggingService.info('Successfully retrieved existing file content', {
                        integrationId,
                        filePath: entryPoint,
                        contentLength: content.length
                    });
                } catch (error: any) {
                    loggingService.warn('Could not fetch existing file content', {
                        integrationId,
                        filePath: entryPoint,
                        error: error.message
                    });
                }
            }

            // Step 3: Generate integration code
            integration.status = 'generating';
            integration.lastActivityAt = new Date();
            await integration.save();

            loggingService.info('Starting code generation step', {
                integrationId,
                integrationType: integration.integrationType,
                existingFilesRetrieved: Object.keys(existingFileContents).length,
                timestamp: new Date().toISOString()
            });

            let generatedCode: IntegrationCode;
            try {
                // Add timeout wrapper (10 minutes max for code generation - allow for retries and fallbacks)
                const CODE_GEN_TIMEOUT = 10 * 60 * 1000; // 10 minutes
                const HEARTBEAT_INTERVAL = 20 * 1000; // 20 seconds - frequent heartbeat updates
                
                // Update lastActivityAt before starting code generation
                integration.lastActivityAt = new Date();
                await integration.save();
                
                loggingService.info('Calling generateIntegrationCode', {
                    integrationId,
                    integrationType: integration.integrationType,
                    timeout: CODE_GEN_TIMEOUT,
                    heartbeatInterval: HEARTBEAT_INTERVAL
                });

                // Set up heartbeat mechanism to update lastActivityAt during long-running operations
                let heartbeatIntervalId: NodeJS.Timeout | null = null;
                const startHeartbeat = () => {
                    heartbeatIntervalId = setInterval(() => {
                        // Use void to explicitly ignore promise return
                        void (async () => {
                            try {
                                const currentIntegration = await GitHubIntegration.findById(integrationId);
                                if (currentIntegration && currentIntegration.status === 'generating') {
                                    currentIntegration.lastActivityAt = new Date();
                                    await currentIntegration.save();
                                    loggingService.info('Code generation heartbeat - activity updated', {
                                        integrationId,
                                        timestamp: new Date().toISOString()
                                    });
                                }
                            } catch (heartbeatError: any) {
                                loggingService.warn('Failed to update heartbeat', {
                                    integrationId,
                                    error: heartbeatError instanceof Error ? heartbeatError.message : String(heartbeatError)
                                });
                            }
                        })();
                    }, HEARTBEAT_INTERVAL);
                };

                // Start heartbeat
                startHeartbeat();
                
                try {
                    // Get user's actual API key from their dashboard
                    let userApiKey: string | undefined;
                    try {
                        const user = await User.findById(integration.userId).select('dashboardApiKeys');
                        if (user?.dashboardApiKeys && user.dashboardApiKeys.length > 0) {
                            // Find first active, non-expired API key
                            const activeKey = user.dashboardApiKeys.find((key: any) => 
                                key.isActive !== false && 
                                (!key.expiresAt || new Date(key.expiresAt) > new Date())
                            );
                            
                            if (activeKey?.encryptedKey) {
                                try {
                                    // Decrypt the API key
                                    const { decrypt } = await import('../utils/helpers');
                                    const [iv, authTag, encrypted] = activeKey.encryptedKey.split(':');
                                    userApiKey = decrypt(encrypted, iv, authTag);
                                    
                                    loggingService.info('Retrieved user API key for code generation', {
                                        userId: integration.userId,
                                        keyId: activeKey.keyId,
                                        keyName: activeKey.name,
                                        hasKey: !!userApiKey
                                    });
                                } catch (decryptError: unknown) {
                                    const errorMessage = decryptError instanceof Error ? decryptError.message : String(decryptError);
                                    loggingService.warn('Failed to decrypt user API key', {
                                        userId: integration.userId,
                                        keyId: activeKey.keyId,
                                        error: errorMessage
                                    });
                                }
                            }
                        }
                    } catch (keyError: unknown) {
                        const errorMessage = keyError instanceof Error ? keyError.message : String(keyError);
                        loggingService.warn('Failed to retrieve user API key', {
                            userId: integration.userId,
                            error: errorMessage
                        });
                    }
                    
                    // Use user's API key if available, otherwise fall back to default or placeholder
                    const apiKeyToUse = userApiKey ?? process.env.COSTKATANA_DEFAULT_API_KEY ?? 'dak_your_key_here';
                    
                    if (!userApiKey) {
                        loggingService.info('Using fallback API key for code generation', {
                            userId: integration.userId,
                            hasDefaultEnv: !!process.env.COSTKATANA_DEFAULT_API_KEY,
                            note: 'User should replace this with their own API key from dashboard'
                        });
                    }
                    
                    generatedCode = await Promise.race([
                        GitHubCodeGeneratorService.generateIntegrationCode(
                            integration.userId,
                            {
                                integrationType: integration.integrationType,
                                features: integration.selectedFeatures,
                                analysis,
                                repositoryName: integration.repositoryName,
                                apiKey: apiKeyToUse,
                                existingFileContents
                            }
                        ),
                        new Promise<IntegrationCode>((_, reject) => 
                            setTimeout(() => {
                                loggingService.error('[TIMEOUT] Code generation timeout reached', {
                                    integrationId,
                                    timeout: CODE_GEN_TIMEOUT,
                                    timeoutMinutes: CODE_GEN_TIMEOUT / 60000,
                                    timestamp: new Date().toISOString(),
                                    recommendation: 'Try again in a few moments or check AWS Bedrock status'
                                });
                                reject(new Error('Code generation timed out after 10 minutes. This may be due to AWS Bedrock throttling, model unavailability, or high project complexity. Please try again in a few moments.'));
                            }, CODE_GEN_TIMEOUT)
                        )
                    ]);
                    
                    // Stop heartbeat on success
                    if (heartbeatIntervalId) {
                        clearInterval(heartbeatIntervalId);
                        heartbeatIntervalId = null;
                    }
                } catch (codeGenPromiseError: any) {
                    // Stop heartbeat on error
                    if (heartbeatIntervalId) {
                        clearInterval(heartbeatIntervalId);
                        heartbeatIntervalId = null;
                    }
                    throw codeGenPromiseError;
                }
            } catch (codeGenError: any) {
                loggingService.error('[ERROR] Code generation failed or timed out', {
                    integrationId,
                    error: codeGenError.message,
                    stack: codeGenError.stack,
                    timestamp: new Date().toISOString(),
                    integrationType: integration.integrationType,
                    language: analysis.language,
                    framework: analysis.framework
                });
                
                // Update status to failed with specific, user-friendly error message
                integration.status = 'failed';
                
                // Provide context-specific error messages
                if (codeGenError.message.includes('timeout') || codeGenError.message.includes('timed out')) {
                    integration.errorMessage = `⏱️ Code generation timed out. This usually happens due to:\n• AWS Bedrock API throttling or rate limits\n• High project complexity\n• Temporary model unavailability\n\n💡 Try again in 2-3 minutes. If the issue persists, contact support.`;
                } else if (codeGenError.message.includes('throttl')) {
                    integration.errorMessage = `🚦 AWS Bedrock is currently throttling requests. Please wait 2-3 minutes and try again.`;
                } else {
                    integration.errorMessage = `❌ Code generation failed: ${codeGenError.message}\n\nPlease try again or contact support if the issue persists.`;
                }
                
                integration.errorStack = codeGenError.stack;
                integration.lastActivityAt = new Date();
                await integration.save();
                
                throw codeGenError; // Re-throw to trigger outer catch block
            }

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

            // Pre-commit validation - final safety check
            const preCommitValidation = this.preCommitValidation(generatedCode, analysis);
            if (!preCommitValidation.isValid) {
                loggingService.error('Pre-commit validation failed', {
                    integrationId,
                    errors: preCommitValidation.errors,
                    warnings: preCommitValidation.warnings
                });

                // Update integration status
                integration.status = 'failed';
                integration.errorMessage = `Pre-commit validation failed: ${preCommitValidation.errors.join('; ')}`;
                await integration.save();

                throw new Error(`Pre-commit validation failed:\n${preCommitValidation.errors.join('\n')}`);
            }

            if (preCommitValidation.warnings.length > 0) {
                loggingService.warn('Pre-commit warnings found', {
                    integrationId,
                    warnings: preCommitValidation.warnings
                });
            }

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
            // Check if it's a GitHub authentication error
            const isAuthError = error.message?.includes('Bad credentials') || 
                               error.message?.includes('Unauthorized') ||
                               error.status === 401 ||
                               error.response?.status === 401;

            const errorMessage = isAuthError
                ? 'GitHub authentication failed. Your access token may have expired or been revoked. Please reconnect your GitHub account from the integrations page.'
                : error.message || 'Integration processing failed';

            loggingService.error('Integration processing failed', {
                integrationId,
                error: error.message,
                stack: error.stack,
                isAuthError,
                status: error.status || error.response?.status
            });

            if (integration) {
                integration.status = 'failed';
                integration.errorMessage = errorMessage;
                integration.errorStack = error.stack;
                await integration.save();

                // If it's an auth error, mark the connection as inactive
                if (isAuthError && connection) {
                    connection.isActive = false;
                    await connection.save();
                    loggingService.info('Marked GitHub connection as inactive due to auth error', {
                        connectionId: connection._id,
                        userId: connection.userId
                    });
                }
            }

            throw error;
        }
    }

    /**
     * Pre-commit validation - final safety check before committing files
     */
    private static preCommitValidation(
        generatedCode: any,
        analysis: any
    ): { isValid: boolean; errors: string[]; warnings: string[] } {
        const errors: string[] = [];
        const warnings: string[] = [];

        const expectedExtension = analysis.language === 'typescript' ? 'ts' : 
                                  analysis.language === 'javascript' ? 'js' :
                                  analysis.language === 'python' ? 'py' :
                                  analysis.language === 'java' ? 'java' :
                                  analysis.language === 'go' ? 'go' : 'js';

        const wrongExtension = analysis.language === 'typescript' ? 'js' : 
                              analysis.language === 'javascript' ? 'ts' : null;

        const forbiddenDirs = ['dist', 'build', 'out', 'lib', '.next', '.nuxt', 'node_modules', '.cache'];

        // Validate each file
        generatedCode.files.forEach((file: any) => {
            // Critical: Check file extension
            if (wrongExtension && file.path.endsWith(`.${wrongExtension}`)) {
                errors.push(`CRITICAL: File has wrong extension for ${analysis.language} project: ${file.path} (expected .${expectedExtension})`);
            }

            // Critical: Check for build output directories
            const pathLower = file.path.toLowerCase();
            const inForbiddenDir = forbiddenDirs.some(dir => 
                pathLower.startsWith(`${dir}/`) || 
                pathLower.includes(`/${dir}/`)
            );

            if (inForbiddenDir) {
                errors.push(`CRITICAL: File in forbidden directory: ${file.path}`);
            }

            // Warning: Check for suspiciously short files
            if (file.content.length < 50 && !file.path.endsWith('.md') && !file.path.endsWith('.example')) {
                warnings.push(`File has very short content: ${file.path} (${file.content.length} chars)`);
            }

            // Warning: Check for missing imports in TypeScript files
            if (analysis.language === 'typescript' && file.path.endsWith('.ts')) {
                if (!file.content.includes('import ') && !file.content.includes('require(')) {
                    warnings.push(`TypeScript file missing imports: ${file.path}`);
                }
            }
        });

        // Check for main integration file
        const mainFile = `src/costkatana.${expectedExtension}`;
        const hasMainFile = generatedCode.files.some((f: any) => 
            f.path === mainFile || f.path.endsWith(`/costkatana.${expectedExtension}`)
        );

        if (!hasMainFile) {
            warnings.push(`Main integration file not found: ${mainFile}`);
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Check and recover stuck integrations (in generating status for more than 10 minutes)
     */
    static async recoverStuckIntegrations(): Promise<number> {
        const STUCK_THRESHOLD = 10 * 60 * 1000; // 10 minutes
        const thresholdTime = new Date(Date.now() - STUCK_THRESHOLD);

        try {
            const stuckIntegrations = await GitHubIntegration.find({
                status: 'generating',
                $or: [
                    { lastActivityAt: { $lt: thresholdTime } },
                    { lastActivityAt: { $exists: false } },
                    { updatedAt: { $lt: thresholdTime } }
                ]
            });

            if (stuckIntegrations.length === 0) {
                return 0;
            }

            loggingService.warn('Found stuck integrations, marking as failed', {
                count: stuckIntegrations.length,
                integrationIds: stuckIntegrations.map(i => i._id.toString())
            });

            for (const integration of stuckIntegrations) {
                integration.status = 'failed';
                integration.errorMessage = 'Integration timed out during code generation. This may be due to model unavailability. Please try again.';
                integration.lastActivityAt = new Date();
                await integration.save();

                loggingService.info('Recovered stuck integration', {
                    integrationId: integration._id.toString(),
                    repository: integration.repositoryFullName
                });
            }

            return stuckIntegrations.length;
        } catch (error: any) {
            loggingService.error('Failed to recover stuck integrations', {
                error: error.message
            });
            return 0;
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
        // First check and recover any stuck integrations
        await this.recoverStuckIntegrations();

        const integration = await GitHubIntegration.findById(integrationId);
        if (!integration) {
            throw new Error('Integration not found');
        }

        // If integration is stuck (generating for > 10 minutes), mark as failed
        if (integration.status === 'generating') {
            const STUCK_THRESHOLD = 10 * 60 * 1000; // 10 minutes
            const lastActivity = integration.lastActivityAt ?? integration.updatedAt;
            const timeSinceLastActivity = Date.now() - lastActivity.getTime();
            
            if (timeSinceLastActivity > STUCK_THRESHOLD) {
                integration.status = 'failed';
                integration.errorMessage = 'Integration timed out during code generation. This may be due to model unavailability. Please try again.';
                integration.lastActivityAt = new Date();
                await integration.save();

                loggingService.warn('Integration was stuck, marked as failed', {
                    integrationId,
                    timeStuck: Math.round(timeSinceLastActivity / 1000 / 60) + ' minutes'
                });
            }
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
            analysis: integration.analysisResults ? {
                ...integration.analysisResults,
                languageConfidence: integration.analysisResults.languageConfidence || 100,
                isTypeScriptPrimary: integration.analysisResults.isTypeScriptPrimary
            } : undefined,
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

        // Validate connection is active
        if (!connection.isActive) {
            integration.status = 'failed';
            integration.errorMessage = 'GitHub connection is inactive. Please reconnect your GitHub account.';
            await integration.save();
            throw new Error('GitHub connection is inactive');
        }

        // Check if token is expired
        if (connection.expiresAt && new Date() > connection.expiresAt) {
            integration.status = 'failed';
            integration.errorMessage = 'GitHub access token has expired. Please reconnect your GitHub account.';
            await integration.save();
            throw new Error('GitHub access token has expired');
        }

        integration.status = 'updating';
        integration.lastActivityAt = new Date();
        await integration.save();

        try {
            const [owner, repo] = integration.repositoryFullName.split('/');
            if (!owner || !repo) {
                throw new Error('Invalid repository full name');
            }

            // Get existing files from the integration branch
            const existingFiles: Record<string, string> = {};
            const filesToCheck = [
                `src/costkatana.${integration.analysisResults?.language === 'typescript' ? 'ts' : integration.analysisResults?.language === 'python' ? 'py' : 'js'}`,
                'COSTKATANA_SETUP.md',
                '.env.example'
            ];

            for (const filePath of filesToCheck) {
                try {
                    const content = await GitHubService.getFileContent(
                        connection,
                        owner,
                        repo,
                        filePath,
                        integration.branchName
                    );
                    existingFiles[filePath] = content;
                    loggingService.info('Retrieved existing file for update', {
                        integrationId,
                        filePath,
                        contentLength: content.length
                    });
                } catch (error: unknown) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    // File might not exist, that's okay
                    if (!errorMessage.includes('404') && !errorMessage.includes('Not Found')) {
                        loggingService.warn('Failed to retrieve existing file', {
                            integrationId,
                            filePath,
                            error: errorMessage
                        });
                    }
                }
            }

            // Parse changes and generate updated code using AI
            const analysis = integration.analysisResults;
            if (!analysis) {
                throw new Error('Integration analysis results not found. Please restart the integration.');
            }

            loggingService.info('Generating updated code based on chat changes', {
                integrationId,
                changes,
                existingFilesCount: Object.keys(existingFiles).length
            });

            // Use AI to parse changes and generate updated code
            const prompt = `You are an expert code assistant updating an existing CostKatana integration based on user feedback.

EXISTING INTEGRATION CONTEXT:
- Repository: ${integration.repositoryFullName}
- Integration Type: ${integration.integrationType}
- Language: ${analysis.language}
- Framework: ${analysis.framework || 'None'}
- Branch: ${integration.branchName}

USER REQUESTED CHANGES:
${changes}

EXISTING FILES IN THE INTEGRATION:
${Object.keys(existingFiles).length > 0 ? Object.entries(existingFiles).map(([path, content]) => `
--- File: ${path} ---
${content.substring(0, 5000)}${content.length > 5000 ? '\n... (truncated)' : ''}
--- End of ${path} ---
`).join('\n') : 'No existing files found'}

SELECTED FEATURES:
${integration.selectedFeatures.map(f => `- ${f.name}${f.config ? ': ' + JSON.stringify(f.config) : ''}`).join('\n')}

YOUR TASK:
1. Understand the user's requested changes
2. Generate updated file contents that incorporate the changes
3. Preserve all existing functionality unless explicitly requested to change
4. Ensure code quality and consistency with the existing codebase

Return ONLY a valid JSON object (no markdown, no explanation) with this exact structure:
{
  "files": [
    {
      "path": "relative/path/to/file",
      "action": "update" | "create" | "delete",
      "content": "COMPLETE file content here (required for update/create actions)"
    }
  ],
  "commitMessage": "Clear, descriptive commit message explaining the changes",
  "prUpdate": {
    "body": "Optional updated PR description (if significant changes were made)"
  }
}

CRITICAL REQUIREMENTS:
- For "update" actions: Provide the COMPLETE file content with all changes integrated
- Maintain code style, patterns, and architecture consistent with existing code
- Only modify files that need to change based on the user's request
- Preserve all existing functionality unless explicitly requested to change
- Ensure all imports, exports, and dependencies are correct`;

            const aiResponse = await AIRouterService.invokeModel(
                integration.userId,
                prompt,
                'us.anthropic.claude-3-5-sonnet-20241022-v2:0'
            );

            // Parse AI response
            const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('Failed to parse AI response. The model did not return valid JSON.');
            }

            const parsedChanges = JSON.parse(jsonMatch[0]) as {
                files: Array<{
                    path: string;
                    action: 'create' | 'update' | 'delete';
                    content?: string;
                }>;
                commitMessage: string;
                prUpdate?: {
                    body?: string;
                };
            };

            if (!parsedChanges.files || !Array.isArray(parsedChanges.files)) {
                throw new Error('Invalid AI response: files array is missing or invalid');
            }

            loggingService.info('Parsed changes from AI', {
                integrationId,
                filesCount: parsedChanges.files.length,
                commitMessage: parsedChanges.commitMessage
            });

            // Apply changes to the branch
            const updatedFiles: string[] = [];
            for (const file of parsedChanges.files) {
                if (file.action === 'delete') {
                    // For deletion, we need to use GitHub API to delete the file
                    // This requires getting the file SHA first
                    try {
                        // Initialize GitHub service and get Octokit instance
                        await GitHubService.initialize();
                        const decryptedToken = connection.decryptToken();
                        const { Octokit } = await import('@octokit/rest');
                        const octokit = new Octokit({ auth: decryptedToken });

                        const { data } = await octokit.rest.repos.getContent({
                            owner,
                            repo,
                            path: file.path,
                            ref: integration.branchName
                        }) as { data: { sha: string; type: string } };

                        if (data.type === 'file' && data.sha) {
                            await octokit.rest.repos.deleteFile({
                                owner,
                                repo,
                                path: file.path,
                                message: `Remove ${file.path} - ${parsedChanges.commitMessage}`,
                                branch: integration.branchName,
                                sha: data.sha
                            });

                            updatedFiles.push(file.path);
                            loggingService.info('Deleted file from integration', {
                                integrationId,
                                filePath: file.path
                            });
                        }
                    } catch (error: unknown) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        const errorStatus = (error as { status?: number }).status;
                        if (errorStatus === 404 || errorMessage.includes('404') || errorMessage.includes('Not Found')) {
                            loggingService.warn('File not found for deletion, skipping', {
                                integrationId,
                                filePath: file.path
                            });
                        } else {
                            throw error;
                        }
                    }
                } else if (file.action === 'create' || file.action === 'update') {
                    if (!file.content) {
                        loggingService.warn('File action is create/update but content is missing, skipping', {
                            integrationId,
                            filePath: file.path
                        });
                        continue;
                    }

                    const result = await GitHubService.createOrUpdateFile(connection, {
                        owner,
                        repo,
                        branch: integration.branchName,
                        path: file.path,
                        content: file.content,
                        message: `${file.action === 'create' ? 'Add' : 'Update'} ${file.path} - ${parsedChanges.commitMessage}`
                    });

                    integration.commits.push({
                        sha: result.commit,
                        message: `${file.action === 'create' ? 'Add' : 'Update'} ${file.path}`,
                        timestamp: new Date()
                    });

                    updatedFiles.push(file.path);
                    loggingService.info('Updated file in integration', {
                        integrationId,
                        filePath: file.path,
                        action: file.action
                    });
                }
            }

            await integration.save();

            // Update PR if body was provided
            if (parsedChanges.prUpdate?.body && integration.prNumber) {
                try {
                    await GitHubService.updatePullRequest(connection, {
                        owner,
                        repo,
                        prNumber: integration.prNumber,
                        body: parsedChanges.prUpdate.body
                    });

                    integration.prDescription = parsedChanges.prUpdate.body;
                    await integration.save();

                    loggingService.info('Updated PR description', {
                        integrationId,
                        prNumber: integration.prNumber
                    });
                } catch (error: unknown) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    loggingService.warn('Failed to update PR description (non-critical)', {
                        integrationId,
                        prNumber: integration.prNumber,
                        error: errorMessage
                    });
                }
            }

            integration.status = 'open';
            integration.lastActivityAt = new Date();
            await integration.save();

            loggingService.info('Integration update completed successfully', {
                integrationId,
                updatedFilesCount: updatedFiles.length,
                updatedFiles
            });
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;

            loggingService.error('Failed to update integration from chat', {
                integrationId,
                error: errorMessage,
                stack: errorStack
            });

            integration.status = 'failed';
            integration.errorMessage = `Failed to apply changes: ${errorMessage}`;
            integration.errorStack = errorStack;
            integration.lastActivityAt = new Date();
            await integration.save();

            throw error;
        }
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



