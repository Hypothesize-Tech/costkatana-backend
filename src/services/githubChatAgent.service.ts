import { TracedBedrockService as BedrockService } from './tracedBedrock.service';
import { GitHubIntegrationService } from './githubIntegration.service';
import { GitHubConnection, GitHubIntegration, Conversation, IGitHubContext } from '../models';
import { loggingService } from './logging.service';

export interface GitHubChatContext {
    conversationId?: string;
    githubContext?: IGitHubContext;
    userId: string;
}

export interface GitHubCommand {
    action: 'start_integration' | 'update_pr' | 'check_status' | 'list_repos' | 'connect' | 'help';
    parameters?: Record<string, any>;
}

export interface GitHubChatResponse {
    message: string;
    data?: any;
    suggestions?: string[];
    requiresAction?: boolean;
    action?: GitHubCommand;
}

export class GitHubChatAgentService {
    /**
     * Process GitHub-related chat messages
     */
    static async processChatMessage(
        context: GitHubChatContext,
        userMessage: string
    ): Promise<GitHubChatResponse> {
        try {
            loggingService.info('Processing GitHub chat message', {
                userId: context.userId,
                conversationId: context.conversationId,
                hasGitHubContext: !!context.githubContext
            });

            // Detect intent and extract command
            const command = await this.detectIntent(userMessage, context);

            // Execute command
            const response = await this.executeCommand(command, context);

            return response;
        } catch (error: any) {
            loggingService.error('GitHub chat message processing failed', {
                userId: context.userId,
                error: error.message,
                stack: error.stack
            });

            return {
                message: `I encountered an error: ${error.message}. Please try again or contact support if the issue persists.`,
                suggestions: ['Check status', 'List repositories', 'Help']
            };
        }
    }

    /**
     * Detect user intent and extract command
     */
    private static async detectIntent(
        message: string,
        context: GitHubChatContext
    ): Promise<GitHubCommand> {
        // Simple keyword-based intent detection
        const lowerMessage = message.toLowerCase();

        // Connect GitHub
        if (lowerMessage.includes('connect') && lowerMessage.includes('github')) {
            return { action: 'connect' };
        }

        // List repositories
        if (lowerMessage.includes('list') && (lowerMessage.includes('repo') || lowerMessage.includes('repository'))) {
            return { action: 'list_repos' };
        }

        // Start integration
        if ((lowerMessage.includes('integrate') || lowerMessage.includes('add') || lowerMessage.includes('setup')) &&
            (lowerMessage.includes('costkatana') || lowerMessage.includes('cost katana'))) {
            return {
                action: 'start_integration',
                parameters: {
                    integrationType: this.detectIntegrationType(message),
                    features: this.detectFeatures(message)
                }
            };
        }

        // Check status
        if (lowerMessage.includes('status') || lowerMessage.includes('progress') || lowerMessage.includes('check')) {
            return { action: 'check_status' };
        }

        // Update PR
        if ((lowerMessage.includes('update') || lowerMessage.includes('change') || lowerMessage.includes('modify')) &&
            context.githubContext?.integrationId) {
            return {
                action: 'update_pr',
                parameters: {
                    changes: message
                }
            };
        }

        // Help
        if (lowerMessage.includes('help') || lowerMessage.includes('what can you do')) {
            return { action: 'help' };
        }

        // Default: Use AI to understand intent
        return await this.detectIntentWithAI(message, context);
    }

    /**
     * Detect integration type from message
     */
    private static detectIntegrationType(message: string): 'npm' | 'cli' | 'python' {
        const lower = message.toLowerCase();
        
        if (lower.includes('python') || lower.includes('py') || lower.includes('pip')) {
            return 'python';
        }
        if (lower.includes('cli') || lower.includes('command line')) {
            return 'cli';
        }
        return 'npm'; // default
    }

    /**
     * Detect features from message
     */
    private static detectFeatures(message: string): string[] {
        const features: string[] = [];
        const lower = message.toLowerCase();

        if (lower.includes('cost track') || lower.includes('tracking')) {
            features.push('cost-tracking');
        }
        if (lower.includes('cortex') || lower.includes('optimization')) {
            features.push('cortex-optimization');
        }
        if (lower.includes('telemetry') || lower.includes('monitoring')) {
            features.push('telemetry');
        }
        if (lower.includes('analytics')) {
            features.push('analytics');
        }
        if (lower.includes('budget')) {
            features.push('budget-management');
        }

        return features.length > 0 ? features : ['cost-tracking']; // default feature
    }

    /**
     * Use AI to detect intent
     */
    private static async detectIntentWithAI(
        message: string,
        context: GitHubChatContext
    ): Promise<GitHubCommand> {
        const prompt = `You are a GitHub integration assistant for CostKatana. Analyze the user's message and determine their intent.

User message: "${message}"

Context:
- Has GitHub connection: ${!!context.githubContext}
- Active integration: ${!!context.githubContext?.integrationId}

Available actions:
1. connect - User wants to connect their GitHub account
2. list_repos - User wants to see their repositories
3. start_integration - User wants to integrate CostKatana into a repo
4. check_status - User wants to check integration status
5. update_pr - User wants to update an existing integration PR
6. help - User needs help or information

Return a JSON object with this structure:
{
  "action": "action_name",
  "parameters": {}
}`;

        try {
            const response = await BedrockService.invokeModel(
                prompt,
                'amazon.nova-pro-v1:0',
                { useSystemPrompt: false }
            );

            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]) as GitHubCommand;
            }
        } catch (error) {
            loggingService.warn('AI intent detection failed, using fallback', {
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }

        return { action: 'help' };
    }

    /**
     * Execute detected command
     */
    private static async executeCommand(
        command: GitHubCommand,
        context: GitHubChatContext
    ): Promise<GitHubChatResponse> {
        switch (command.action) {
            case 'connect':
                return this.handleConnectCommand(context);
            
            case 'list_repos':
                return this.handleListReposCommand(context);
            
            case 'start_integration':
                return this.handleStartIntegrationCommand(context, command.parameters);
            
            case 'check_status':
                return this.handleCheckStatusCommand(context);
            
            case 'update_pr':
                return this.handleUpdatePRCommand(context, command.parameters);
            
            case 'help':
                return this.handleHelpCommand();
            
            default:
                return {
                    message: "I'm not sure what you'd like to do. Would you like to connect your GitHub repository or check the status of an existing integration?",
                    suggestions: ['Connect GitHub', 'List repositories', 'Check status', 'Help']
                };
        }
    }

    /**
     * Handle connect command
     */
    private static async handleConnectCommand(context: GitHubChatContext): Promise<GitHubChatResponse> {
        // Check if already connected
        const connections = await GitHubConnection.find({
            userId: context.userId,
            isActive: true
        });

        if (connections.length > 0) {
            return {
                message: `You already have ${connections.length} GitHub connection(s). Would you like to connect another account or work with an existing one?`,
                data: { connections },
                suggestions: ['List my repositories', 'Start integration', 'Disconnect']
            };
        }

        const authUrl = `${process.env.BACKEND_URL || 'http://localhost:8000'}/api/github/auth`;

        return {
            message: "Great! Let's connect your GitHub account. Please click the button below to authorize CostKatana.",
            requiresAction: true,
            action: {
                action: 'connect',
                parameters: { authUrl }
            },
            suggestions: ['What can you do?', 'Help']
        };
    }

    /**
     * Handle list repositories command
     */
    private static async handleListReposCommand(context: GitHubChatContext): Promise<GitHubChatResponse> {
        const connections = await GitHubConnection.find({
            userId: context.userId,
            isActive: true
        });

        if (connections.length === 0) {
            return {
                message: "You haven't connected any GitHub accounts yet. Would you like to connect one now?",
                suggestions: ['Connect GitHub', 'Help']
            };
        }

        const repositories = connections.flatMap(conn => conn.repositories);

        return {
            message: `I found ${repositories.length} repositories across ${connections.length} GitHub account(s). Which repository would you like to integrate CostKatana into?`,
            data: { repositories, connections },
            suggestions: repositories.slice(0, 5).map(r => `Integrate into ${r.name}`)
        };
    }

    /**
     * Handle start integration command
     */
    private static async handleStartIntegrationCommand(
        context: GitHubChatContext,
        parameters?: Record<string, any>
    ): Promise<GitHubChatResponse> {
        if (!context.githubContext?.repositoryId) {
            return {
                message: "Which repository would you like to integrate CostKatana into? Please select one from your repositories.",
                suggestions: ['List my repositories']
            };
        }

        // Default features if not specified
        const features = parameters?.features || ['cost-tracking', 'telemetry'];
        const integrationType = parameters?.integrationType || 'npm';

        const connection = await GitHubConnection.findById(context.githubContext.connectionId);
        if (!connection) {
            return {
                message: "I couldn't find your GitHub connection. Please reconnect your account.",
                suggestions: ['Connect GitHub']
            };
        }

        const repository = connection.repositories.find(r => r.id === context.githubContext?.repositoryId);
        if (!repository) {
            return {
                message: "I couldn't find that repository. Please select a valid repository.",
                suggestions: ['List my repositories']
            };
        }

        // Start integration
        const integration = await GitHubIntegrationService.startIntegration({
            userId: context.userId,
            connectionId: connection._id.toString(),
            repositoryId: repository.id,
            repositoryName: repository.name,
            repositoryFullName: repository.fullName,
            integrationType: integrationType as 'npm' | 'cli' | 'python',
            selectedFeatures: features.map((name: string) => ({ name, enabled: true })),
            conversationId: context.conversationId
        });

        // Update conversation with GitHub context
        if (context.conversationId) {
            await Conversation.findByIdAndUpdate(context.conversationId, {
                githubContext: {
                    connectionId: connection._id,
                    repositoryId: repository.id,
                    repositoryName: repository.name,
                    repositoryFullName: repository.fullName,
                    integrationId: integration._id,
                    branchName: integration.branchName
                }
            });
        }

        return {
            message: `🚀 Great! I'm starting the integration process for **${repository.fullName}**.\n\nI'm currently:\n1. Analyzing your repository structure\n2. Detecting frameworks and dependencies\n3. Generating integration code\n4. Creating a pull request\n\nThis usually takes 1-2 minutes. I'll let you know when the PR is ready!`,
            data: { integrationId: integration._id.toString() },
            suggestions: ['Check status', 'What happens next?']
        };
    }

    /**
     * Handle check status command
     */
    private static async handleCheckStatusCommand(context: GitHubChatContext): Promise<GitHubChatResponse> {
        if (!context.githubContext?.integrationId) {
            const integrations = await GitHubIntegration.find({ userId: context.userId })
                .sort({ createdAt: -1 })
                .limit(5);

            if (integrations.length === 0) {
                return {
                    message: "You don't have any active integrations. Would you like to start one?",
                    suggestions: ['Start integration', 'List repositories']
                };
            }

            return {
                message: `You have ${integrations.length} integration(s). Here are the most recent:`,
                data: { integrations },
                suggestions: integrations.map(i => `Check ${i.repositoryName}`)
            };
        }

        const progress = await GitHubIntegrationService.getIntegrationStatus(
            context.githubContext.integrationId.toString()
        );

        let statusMessage = `**Status**: ${progress.status}\n**Progress**: ${progress.progress}%\n**Current Step**: ${progress.currentStep}`;

        if (progress.prUrl) {
            statusMessage += `\n\n🎉 Pull request created! [View PR](${progress.prUrl})`;
        }

        if (progress.errorMessage) {
            statusMessage += `\n\n⚠️ Error: ${progress.errorMessage}`;
        }

        return {
            message: statusMessage,
            data: progress,
            suggestions: progress.status === 'open' ? ['Update PR', 'View changes', 'What next?'] : ['Check status again']
        };
    }

    /**
     * Handle update PR command
     */
    private static async handleUpdatePRCommand(
        context: GitHubChatContext,
        parameters?: Record<string, any>
    ): Promise<GitHubChatResponse> {
        if (!context.githubContext?.integrationId) {
            return {
                message: "I don't see an active integration to update. Please start an integration first.",
                suggestions: ['Start integration', 'List integrations']
            };
        }

        const changes = parameters?.changes || '';
        if (!changes) {
            return {
                message: "What changes would you like me to make to the integration? Please describe what you'd like to update.",
                suggestions: ['Add feature X', 'Change configuration', 'Update dependencies']
            };
        }

        await GitHubIntegrationService.updateIntegrationFromChat(
            context.githubContext.integrationId.toString(),
            changes
        );

        return {
            message: `I'm updating the pull request with your requested changes. This may take a moment...\n\nChanges requested: ${changes}`,
            suggestions: ['Check status', 'View PR']
        };
    }

    /**
     * Handle help command
     */
    private static handleHelpCommand(): GitHubChatResponse {
        return {
            message: `I'm your GitHub integration assistant! Here's what I can help you with:

🔗 **Connect GitHub**: Link your GitHub account to get started
📂 **List Repositories**: See all your repositories
🚀 **Start Integration**: Automatically integrate CostKatana into any repo
✅ **Check Status**: Monitor integration progress
🔄 **Update PR**: Modify integration based on your feedback

Just tell me what you'd like to do, and I'll guide you through it!

**Example commands:**
- "Connect my GitHub account"
- "List my repositories"
- "Integrate CostKatana into my project"
- "Check the status of my integration"
- "Update the PR to add feature X"`,
            suggestions: ['Connect GitHub', 'List repositories', 'Start integration']
        };
    }
}

export default GitHubChatAgentService;



