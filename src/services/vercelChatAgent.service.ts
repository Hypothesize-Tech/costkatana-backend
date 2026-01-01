import { AIRouterService } from './aiRouter.service';
import { VercelService } from './vercel.service';
import { VercelMCPService } from './vercelMcp.service';
import { IVercelConnection } from '../models/VercelConnection';
import { loggingService } from './logging.service';

/**
 * Vercel Chat Agent Service
 * 
 * ARCHITECTURE:
 * - Uses Vercel's Official MCP Server for READ operations via VercelMCPService
 * - Uses Direct Vercel API via VercelService for WRITE operations
 * - All operations wrapped in MCP security handler for rate limiting and audit logging
 * - Provides real-time activity tracking for transparency
 */

export interface VercelChatContext {
    conversationId?: string;
    vercelConnectionId?: string;
    userId: string;
    projectName?: string;
    deployments?: any[];
    domains?: any[];
    envVars?: any[];
    projects?: any[];
}

export interface VercelCommand {
    action: 'list_projects' | 'deploy' | 'rollback' | 'promote' | 'list_deployments' | 
            'get_logs' | 'list_domains' | 'add_domain' | 'list_env' | 'set_env' | 
            'get_analytics' | 'connect' | 'help';
    parameters?: Record<string, any>;
}

export interface VercelChatResponse {
    message: string;
    data?: any;
    suggestions?: string[];
    requiresAction?: boolean;
    action?: VercelCommand;
}

export class VercelChatAgentService {
    /**
     * Parse user message to detect Vercel-related intents
     */
    static parseVercelIntent(message: string): VercelCommand | null {
        const lowerMessage = message.toLowerCase();
        
        // Connect intent
        if (lowerMessage.includes('connect vercel') || 
            lowerMessage.includes('link vercel') ||
            lowerMessage.includes('setup vercel')) {
            return { action: 'connect' };
        }

        // List projects intent
        if (lowerMessage.includes('list') && lowerMessage.includes('project') ||
            lowerMessage.includes('show') && lowerMessage.includes('project') ||
            lowerMessage.includes('my vercel project')) {
            return { action: 'list_projects' };
        }

        // Deploy intent
        if (lowerMessage.includes('deploy') || 
            lowerMessage.includes('push to vercel') ||
            lowerMessage.includes('ship')) {
            const projectMatch = message.match(/(?:deploy|ship)\s+(?:to\s+)?["']?([a-zA-Z0-9-_]+)["']?/i);
            const targetMatch = message.match(/(?:to\s+)?(production|preview)/i);
            return {
                action: 'deploy',
                parameters: {
                    projectName: projectMatch?.[1],
                    target: targetMatch?.[1]?.toLowerCase() || 'preview'
                }
            };
        }

        // Rollback intent
        if (lowerMessage.includes('rollback') || 
            lowerMessage.includes('revert') ||
            lowerMessage.includes('go back')) {
            const projectMatch = message.match(/(?:rollback|revert)\s+["']?([a-zA-Z0-9-_]+)["']?/i);
            return {
                action: 'rollback',
                parameters: {
                    projectName: projectMatch?.[1]
                }
            };
        }

        // Promote intent
        if (lowerMessage.includes('promote') || 
            (lowerMessage.includes('to production') && !lowerMessage.includes('deploy'))) {
            const deploymentMatch = message.match(/promote\s+["']?([a-zA-Z0-9-_]+)["']?/i);
            return {
                action: 'promote',
                parameters: {
                    deploymentId: deploymentMatch?.[1]
                }
            };
        }

        // List deployments intent
        if ((lowerMessage.includes('deployment') || lowerMessage.includes('build')) &&
            (lowerMessage.includes('list') || lowerMessage.includes('show') || lowerMessage.includes('history'))) {
            const projectMatch = message.match(/(?:for|of)\s+["']?([a-zA-Z0-9-_]+)["']?/i);
            return {
                action: 'list_deployments',
                parameters: {
                    projectName: projectMatch?.[1]
                }
            };
        }

        // Get logs intent
        if (lowerMessage.includes('log') || 
            lowerMessage.includes('build output') ||
            lowerMessage.includes('deployment output')) {
            const projectMatch = message.match(/(?:for|of)\s+["']?([a-zA-Z0-9-_]+)["']?/i);
            return {
                action: 'get_logs',
                parameters: {
                    projectName: projectMatch?.[1]
                }
            };
        }

        // Domain intents
        if (lowerMessage.includes('domain')) {
            if (lowerMessage.includes('add') || lowerMessage.includes('set')) {
                const domainMatch = message.match(/(?:add|set)\s+(?:domain\s+)?["']?([a-zA-Z0-9.-]+)["']?/i);
                const projectMatch = message.match(/(?:to|for)\s+["']?([a-zA-Z0-9-_]+)["']?/i);
                return {
                    action: 'add_domain',
                    parameters: {
                        domain: domainMatch?.[1],
                        projectName: projectMatch?.[1]
                    }
                };
            }
            return {
                action: 'list_domains',
                parameters: {
                    projectName: message.match(/(?:for|of)\s+["']?([a-zA-Z0-9-_]+)["']?/i)?.[1]
                }
            };
        }

        // Environment variable intents
        if (lowerMessage.includes('env') || 
            lowerMessage.includes('environment') ||
            lowerMessage.includes('variable') ||
            lowerMessage.includes('secret')) {
            if (lowerMessage.includes('set') || lowerMessage.includes('add') || lowerMessage.includes('create')) {
                const keyMatch = message.match(/(?:set|add|create)\s+(?:env(?:ironment)?\s+(?:var(?:iable)?)?\s+)?["']?([A-Z_][A-Z0-9_]*)["']?/i);
                const valueMatch = message.match(/(?:to|=|value)\s+["']?([^"'\s]+)["']?/i);
                const projectMatch = message.match(/(?:for|in|on)\s+["']?([a-zA-Z0-9-_]+)["']?/i);
                return {
                    action: 'set_env',
                    parameters: {
                        key: keyMatch?.[1],
                        value: valueMatch?.[1],
                        projectName: projectMatch?.[1]
                    }
                };
            }
            return {
                action: 'list_env',
                parameters: {
                    projectName: message.match(/(?:for|of|in)\s+["']?([a-zA-Z0-9-_]+)["']?/i)?.[1]
                }
            };
        }

        // Analytics intent
        if (lowerMessage.includes('analytics') || 
            lowerMessage.includes('stats') ||
            lowerMessage.includes('usage') ||
            lowerMessage.includes('traffic')) {
            const projectMatch = message.match(/(?:for|of)\s+["']?([a-zA-Z0-9-_]+)["']?/i);
            return {
                action: 'get_analytics',
                parameters: {
                    projectName: projectMatch?.[1]
                }
            };
        }

        // Help intent
        if (lowerMessage.includes('help') && lowerMessage.includes('vercel')) {
            return { action: 'help' };
        }

        return null;
    }

    /**
     * Process a Vercel-related chat message
     * ALL operations go through MCP handler for security, rate limiting, and audit logging
     */
    static async processMessage(
        message: string,
        context: VercelChatContext
    ): Promise<VercelChatResponse> {
        try {
            // Check for Vercel connection
            const connections = await VercelService.listConnections(context.userId);
            const connection = context.vercelConnectionId 
                ? connections.find(c => c._id.toString() === context.vercelConnectionId)
                : connections[0];

            // Parse intent
            const command = this.parseVercelIntent(message);

            if (!command) {
                return this.generateAIResponse(message, context, connection);
            }

            // Handle connect action (no connection required)
            if (command.action === 'connect') {
                if (connection?.isActive) {
                    return {
                        message: `You're already connected to Vercel as **${connection.vercelUsername}**${connection.teamSlug ? ` (Team: ${connection.teamSlug})` : ''}. Would you like to reconnect or manage your projects?`,
                        suggestions: ['Show my projects', 'Disconnect Vercel', 'Deploy to Vercel']
                    };
                }
                return {
                    message: 'To connect your Vercel account, click the "Connect Vercel" button in the Apps menu or visit the Integrations page.',
                    requiresAction: true,
                    action: command,
                    suggestions: ['Go to Integrations', 'What can Vercel do?']
                };
            }

            // Handle help action
            if (command.action === 'help') {
                return this.getHelpResponse();
            }

            // Check connection for other actions
            if (!connection?.isActive) {
                return {
                    message: 'You need to connect your Vercel account first to perform this action.',
                    requiresAction: true,
                    action: { action: 'connect' },
                    suggestions: ['Connect Vercel', 'What is Vercel?']
                };
            }

            // ✅ ALL operations go through MCP handler for security
            // Convert to integration command format and route through MCP
            const integrationCommand = this.convertToIntegrationCommand(command, connection);
            if (integrationCommand) {
                const { MCPIntegrationHandler } = await import('./mcpIntegrationHandler.service');
                const mcpResult = await MCPIntegrationHandler.handleIntegrationOperation({
                    userId: context.userId,
                    command: integrationCommand,
                    context: {
                        message,
                        vercelConnectionId: connection._id.toString()
                    }
                });

                if (mcpResult.success && mcpResult.result.success) {
                    return {
                        message: mcpResult.result.message,
                        data: mcpResult.result.data,
                        suggestions: this.getSuggestionsForAction(command.action)
                    };
                } else {
                    return {
                        message: mcpResult.result.message || 'Operation failed',
                        suggestions: ['Show my projects', 'Help with Vercel']
                    };
                }
            }

            // Fallback: Execute command directly (for help and connect actions only)
            return this.executeCommand(command, connection, context);
        } catch (error: any) {
            loggingService.error('Vercel chat agent error', {
                error: error.message,
                userId: context.userId
            });
            return {
                message: `I encountered an error: ${error.message}. Please try again or check your Vercel connection.`,
                suggestions: ['Show my projects', 'Help with Vercel']
            };
        }
    }

    /**
     * Convert Vercel command to integration command format for MCP handler
     */
    private static convertToIntegrationCommand(
        command: VercelCommand,
        connection: any
    ): any | null {
        const mention = {
            integration: 'vercel',
            entityType: '',
            entityId: connection?._id ? connection._id.toString() : '',
            rawText: `@vercel ${command.action}`
        };

        // Map Vercel actions to integration command types
        const actionMap: Record<string, { type: string; entity: string }> = {
            list_projects: { type: 'list', entity: 'projects' },
            deploy: { type: 'create', entity: 'deployment' },
            rollback: { type: 'update', entity: 'deployment' },
            promote: { type: 'update', entity: 'deployment' },
            list_deployments: { type: 'list', entity: 'deployments' },
            get_logs: { type: 'get', entity: 'logs' },
            list_domains: { type: 'list', entity: 'domains' },
            add_domain: { type: 'create', entity: 'domain' },
            list_env: { type: 'list', entity: 'env' },
            set_env: { type: 'create', entity: 'env' },
            get_analytics: { type: 'get', entity: 'analytics' }
        };

        const mapping = actionMap[command.action];
        if (!mapping) {
            return null;
        }

        return {
            type: mapping.type,
            entity: mapping.entity,
            params: command.parameters ?? {},
            mention
        };
    }

    /**
     * Get contextual suggestions based on action
     */
    private static getSuggestionsForAction(action: string): string[] {
        const suggestionMap: Record<string, string[]> = {
            list_projects: ['Deploy to Vercel', 'Show deployments', 'Get analytics'],
            deploy: ['Show deployments', 'Get logs', 'Promote to production'],
            rollback: ['Show deployments', 'Deploy again'],
            promote: ['Show deployments', 'Get analytics'],
            list_deployments: ['Deploy', 'Get logs', 'Rollback'],
            get_logs: ['Deploy again', 'Show deployments'],
            list_domains: ['Add domain', 'Show projects'],
            add_domain: ['List domains', 'Deploy'],
            list_env: ['Set env var', 'Deploy'],
            set_env: ['List env vars', 'Deploy'],
            get_analytics: ['Deploy', 'Show projects']
        };

        return suggestionMap[action] || ['Show my projects', 'Help with Vercel'];
    }

    /**
     * Execute a Vercel command
     */
    private static async executeCommand(
        command: VercelCommand,
        connection: IVercelConnection,
        context: VercelChatContext
    ): Promise<VercelChatResponse> {
        const connectionId = connection._id.toString();

        switch (command.action) {
            case 'list_projects':
                return this.handleListProjects(connectionId);

            case 'deploy':
                return this.handleDeploy(connectionId, command.parameters, context);

            case 'rollback':
                return this.handleRollback(connectionId, command.parameters, context);

            case 'promote':
                return this.handlePromote(connectionId, command.parameters);

            case 'list_deployments':
                return this.handleListDeployments(connectionId, command.parameters, context);

            case 'get_logs':
                return this.handleGetLogs(connectionId, command.parameters, context);

            case 'list_domains':
                return this.handleListDomains(connectionId, command.parameters, context);

            case 'add_domain':
                return this.handleAddDomain(connectionId, command.parameters, context);

            case 'list_env':
                return this.handleListEnv(connectionId, command.parameters, context);

            case 'set_env':
                return this.handleSetEnv(connectionId, command.parameters, context);

            case 'get_analytics':
                return this.handleGetAnalytics(connectionId, command.parameters, context);

            default:
                return {
                    message: 'I\'m not sure how to handle that Vercel command. Try asking for help.',
                    suggestions: ['Help with Vercel', 'Show my projects']
                };
        }
    }

    /**
     * Handle list projects command
     * Uses Vercel's official MCP server for optimal performance
     */
    private static async handleListProjects(connectionId: string): Promise<VercelChatResponse> {
        
        try {
            
            // Use Vercel MCP for read operation
            const mcpProjects = await VercelMCPService.listProjects(connectionId);
            
            
            if (!mcpProjects || mcpProjects.length === 0) {
                return {
                    message: 'You don\'t have any projects in Vercel yet. Create a project on Vercel first, or deploy a new project.',
                    suggestions: ['How to create a Vercel project?', 'Deploy to Vercel'],
                };
            }

            const projectList = mcpProjects.map((p: any) => {
                const status = p.latestDeployment?.readyState || 'No deployments';
                const statusEmoji = status === 'READY' ? '✅' : status === 'BUILDING' ? '🔄' : status === 'ERROR' ? '❌' : '⏳';
                return `- **${p.name}** ${statusEmoji} (${p.framework || 'Unknown framework'})`;
            }).join('\n');


            return {
                message: `Here are your Vercel projects:\n\n${projectList}`,
                data: mcpProjects,
                suggestions: mcpProjects.slice(0, 3).map((p: any) => `Deploy ${p.name}`),
            };
        } catch (error: any) {
            loggingService.warn('MCP list projects failed, falling back to direct API', {
                error: error.message
            });
            
            
            // Fallback to direct API
            const projects = await VercelService.getProjects(connectionId, true);
            

            if (projects.length === 0) {
                return {
                    message: 'You don\'t have any projects in Vercel yet. Create a project on Vercel first, or deploy a new project.',
                    suggestions: ['How to create a Vercel project?', 'Deploy to Vercel'],
                };
            }

            const projectList = projects.map(p => {
                const status = p.latestDeployment?.state || 'No deployments';
                const statusEmoji = status === 'READY' ? '✅' : status === 'BUILDING' ? '🔄' : status === 'ERROR' ? '❌' : '⏳';
                return `- **${p.name}** ${statusEmoji} (${p.framework || 'Unknown framework'})`;
            }).join('\n');


            return {
                message: `Here are your Vercel projects:\n\n${projectList}`,
                data: projects,
                suggestions: projects.slice(0, 3).map(p => `Deploy ${p.name}`),
            };
        }
    }

    /**
     * Handle deploy command
     * Uses context to infer project if not specified
     */
    private static async handleDeploy(
        connectionId: string,
        params?: Record<string, any>,
        context?: VercelChatContext
    ): Promise<VercelChatResponse> {
        const projects = await VercelService.getProjects(connectionId);

        // Use context.projectName if params.projectName is not provided
        if (!params?.projectName && context?.projectName) {
            params = { ...params, projectName: context.projectName };
        }

        if (!params?.projectName) {
            if (projects.length === 1) {
                params = { ...params, projectName: projects[0].name };
            } else {
                return {
                    message: 'Which project would you like to deploy?',
                    suggestions: projects.slice(0, 5).map(p => `Deploy ${p.name}`)
                };
            }
        }

        const project = projects.find(p => 
            p.name.toLowerCase() === params?.projectName?.toLowerCase()
        );

        if (!project) {
            return {
                message: `I couldn't find a project named "${params.projectName}". Here are your projects:`,
                suggestions: projects.slice(0, 5).map(p => `Deploy ${p.name}`)
            };
        }

        const deployment = await VercelService.triggerDeployment(connectionId, project.id, {
            target: params.target || 'preview'
        });

        return {
            message: `🚀 Deployment triggered for **${project.name}**!\n\n` +
                `- **Status**: ${deployment.state}\n` +
                `- **Target**: ${params.target || 'preview'}\n` +
                `- **URL**: https://${deployment.url}`,
            data: deployment,
            suggestions: [`Show deployments for ${project.name}`, `Get logs for ${project.name}`]
        };
    }

    /**
     * Handle rollback command
     * Uses context to infer project if not specified
     */
    private static async handleRollback(
        connectionId: string,
        params?: Record<string, any>,
        context?: VercelChatContext
    ): Promise<VercelChatResponse> {
        const projects = await VercelService.getProjects(connectionId);

        // Use context.projectName if params.projectName is not provided
        if (!params?.projectName && context?.projectName) {
            params = { ...params, projectName: context.projectName };
        }

        if (!params?.projectName) {
            return {
                message: 'Which project would you like to rollback?',
                suggestions: projects.slice(0, 5).map(p => `Rollback ${p.name}`)
            };
        }

        const project = projects.find(p => 
            p.name.toLowerCase() === params?.projectName?.toLowerCase()
        );

        if (!project) {
            return {
                message: `I couldn't find a project named "${params.projectName}".`,
                suggestions: projects.slice(0, 5).map(p => `Rollback ${p.name}`)
            };
        }

        // Get previous successful deployment
        const deployments = await VercelService.getDeployments(connectionId, project.id, 10);
        const previousDeployment = deployments.find(d => 
            d.state === 'READY' && d.target === 'production'
        );

        if (!previousDeployment) {
            return {
                message: `No previous production deployment found for **${project.name}** to rollback to.`,
                suggestions: [`Show deployments for ${project.name}`]
            };
        }

        const rollback = await VercelService.rollbackDeployment(
            connectionId,
            project.id,
            previousDeployment.uid
        );

        return {
            message: `⏪ Rolled back **${project.name}** to previous deployment!\n\n` +
                `- **Deployment ID**: ${previousDeployment.uid.substring(0, 8)}...\n` +
                `- **URL**: https://${previousDeployment.url}`,
            data: rollback,
            suggestions: [`Show deployments for ${project.name}`, `Deploy ${project.name}`]
        };
    }

    /**
     * Handle promote command
     */
    private static async handlePromote(
        connectionId: string,
        params?: Record<string, any>
    ): Promise<VercelChatResponse> {
        if (!params?.deploymentId) {
            return {
                message: 'Please specify which deployment to promote to production.',
                suggestions: ['Show my deployments', 'Help with Vercel']
            };
        }

        const deployment = await VercelService.promoteDeployment(connectionId, params.deploymentId);

        return {
            message: `🎉 Deployment promoted to production!\n\n` +
                `- **URL**: https://${deployment.url}`,
            data: deployment,
            suggestions: ['Show my projects', 'Get analytics']
        };
    }

    /**
     * Handle list deployments command
     * Uses context to infer project if not specified
     */
    private static async handleListDeployments(
        connectionId: string,
        params?: Record<string, any>,
        context?: VercelChatContext
    ): Promise<VercelChatResponse> {
        const projects = await VercelService.getProjects(connectionId);

        // Use context.projectName if params.projectName is not provided
        if (!params?.projectName && context?.projectName) {
            params = { projectName: context.projectName };
        }

        if (!params?.projectName) {
            if (projects.length === 1) {
                params = { projectName: projects[0].name };
            } else {
                return {
                    message: 'Which project\'s deployments would you like to see?',
                    suggestions: projects.slice(0, 5).map(p => `Show deployments for ${p.name}`)
                };
            }
        }

        const project = projects.find(p => 
            p.name.toLowerCase() === params?.projectName?.toLowerCase()
        );

        if (!project) {
            return {
                message: `I couldn't find a project named "${params.projectName}".`,
                suggestions: projects.slice(0, 5).map(p => `Show deployments for ${p.name}`)
            };
        }

        const deployments = await VercelService.getDeployments(connectionId, project.id, 10);

        if (deployments.length === 0) {
            return {
                message: `No deployments found for **${project.name}**.`,
                suggestions: [`Deploy ${project.name}`]
            };
        }

        const deploymentList = deployments.slice(0, 5).map(d => {
            const statusEmoji = d.state === 'READY' ? '✅' : d.state === 'BUILDING' ? '🔄' : d.state === 'ERROR' ? '❌' : '⏳';
            const date = new Date(d.createdAt).toLocaleDateString();
            return `- ${statusEmoji} **${d.uid.substring(0, 8)}** - ${d.state} (${date}) - ${d.target || 'preview'}`;
        }).join('\n');

        return {
            message: `Recent deployments for **${project.name}**:\n\n${deploymentList}`,
            data: deployments,
            suggestions: [`Deploy ${project.name}`, `Get logs for ${project.name}`]
        };
    }

    /**
     * Handle get logs command
     * Uses context to infer project if not specified
     */
    private static async handleGetLogs(
        connectionId: string,
        params?: Record<string, any>,
        context?: VercelChatContext
    ): Promise<VercelChatResponse> {
        const projects = await VercelService.getProjects(connectionId);

        // Use context.projectName if params.projectName is not provided
        if (!params?.projectName && context?.projectName) {
            params = { projectName: context.projectName };
        }

        if (!params?.projectName) {
            if (projects.length === 1) {
                params = { projectName: projects[0].name };
            } else {
                return {
                    message: 'Which project\'s logs would you like to see?',
                    suggestions: projects.slice(0, 5).map(p => `Get logs for ${p.name}`)
                };
            }
        }

        const project = projects.find(p => 
            p.name.toLowerCase() === params?.projectName?.toLowerCase()
        );

        if (!project) {
            return {
                message: `I couldn't find a project named "${params.projectName}".`,
                suggestions: projects.slice(0, 5).map(p => `Get logs for ${p.name}`)
            };
        }

        // Get latest deployment
        const deployments = await VercelService.getDeployments(connectionId, project.id, 1);
        if (deployments.length === 0) {
            return {
                message: `No deployments found for **${project.name}**.`,
                suggestions: [`Deploy ${project.name}`]
            };
        }

        const logs = await VercelService.getDeploymentLogs(connectionId, deployments[0].uid);
        const logPreview = logs.slice(-20).join('\n');

        return {
            message: `Latest build logs for **${project.name}**:\n\n\`\`\`\n${logPreview}\n\`\`\``,
            data: logs,
            suggestions: [`Deploy ${project.name}`, `Show deployments for ${project.name}`]
        };
    }

    /**
     * Handle list domains command
     * Uses context to infer project if not specified
     */
    private static async handleListDomains(
        connectionId: string,
        params?: Record<string, any>,
        context?: VercelChatContext
    ): Promise<VercelChatResponse> {
        const projects = await VercelService.getProjects(connectionId);

        // Use context.projectName if params.projectName is not provided
        if (!params?.projectName && context?.projectName) {
            params = { projectName: context.projectName };
        }

        if (!params?.projectName) {
            if (projects.length === 1) {
                params = { projectName: projects[0].name };
            } else {
                return {
                    message: 'Which project\'s domains would you like to see?',
                    suggestions: projects.slice(0, 5).map(p => `Show domains for ${p.name}`)
                };
            }
        }

        const project = projects.find(p => 
            p.name.toLowerCase() === params?.projectName?.toLowerCase()
        );

        if (!project) {
            return {
                message: `I couldn't find a project named "${params.projectName}".`,
                suggestions: projects.slice(0, 5).map(p => `Show domains for ${p.name}`)
            };
        }

        const domains = await VercelService.getDomains(connectionId, project.id);

        if (domains.length === 0) {
            return {
                message: `No custom domains configured for **${project.name}**.`,
                suggestions: [`Add domain to ${project.name}`]
            };
        }

        const domainList = domains.map(d => {
            const statusEmoji = d.verified ? '✅' : '⏳';
            return `- ${statusEmoji} **${d.name}** ${d.verified ? '(Verified)' : '(Pending verification)'}`;
        }).join('\n');

        return {
            message: `Domains for **${project.name}**:\n\n${domainList}`,
            data: domains,
            suggestions: [`Add domain to ${project.name}`, `Deploy ${project.name}`]
        };
    }

    /**
     * Handle add domain command
     * Uses context to infer project if not specified
     */
    private static async handleAddDomain(
        connectionId: string,
        params?: Record<string, any>,
        context?: VercelChatContext
    ): Promise<VercelChatResponse> {
        // Use context.projectName if params.projectName is not provided
        if (!params?.projectName && context?.projectName) {
            params = { ...params, projectName: context.projectName };
        }

        if (!params?.domain || !params?.projectName) {
            return {
                message: 'Please specify both the domain and project name. For example: "Add domain example.com to my-project"',
                suggestions: ['Show my projects', 'Help with Vercel']
            };
        }

        const projects = await VercelService.getProjects(connectionId);
        const project = projects.find(p => 
            p.name.toLowerCase() === params?.projectName?.toLowerCase()
        );

        if (!project) {
            return {
                message: `I couldn't find a project named "${params.projectName}".`,
                suggestions: projects.slice(0, 5).map(p => `Add domain to ${p.name}`)
            };
        }

        const domain = await VercelService.addDomain(connectionId, project.id, params.domain);

        let message = `🌐 Domain **${params.domain}** added to **${project.name}**!`;
        
        if (!domain.verified && domain.verification) {
            message += '\n\n**DNS Configuration Required:**\n';
            domain.verification.forEach(v => {
                message += `- Type: ${v.type}, Domain: ${v.domain}, Value: ${v.value}\n`;
            });
        }

        return {
            message,
            data: domain,
            suggestions: [`Show domains for ${project.name}`, `Deploy ${project.name}`]
        };
    }

    /**
     * Handle list environment variables command
     * Uses context to infer project if not specified
     */
    private static async handleListEnv(
        connectionId: string,
        params?: Record<string, any>,
        context?: VercelChatContext
    ): Promise<VercelChatResponse> {
        const projects = await VercelService.getProjects(connectionId);

        // Use context.projectName if params.projectName is not provided
        if (!params?.projectName && context?.projectName) {
            params = { projectName: context.projectName };
        }

        if (!params?.projectName) {
            if (projects.length === 1) {
                params = { projectName: projects[0].name };
            } else {
                return {
                    message: 'Which project\'s environment variables would you like to see?',
                    suggestions: projects.slice(0, 5).map(p => `Show env vars for ${p.name}`)
                };
            }
        }

        const project = projects.find(p => 
            p.name.toLowerCase() === params?.projectName?.toLowerCase()
        );

        if (!project) {
            return {
                message: `I couldn't find a project named "${params.projectName}".`,
                suggestions: projects.slice(0, 5).map(p => `Show env vars for ${p.name}`)
            };
        }

        const envVars = await VercelService.getEnvVars(connectionId, project.id);

        if (envVars.length === 0) {
            return {
                message: `No environment variables configured for **${project.name}**.`,
                suggestions: [`Set env var for ${project.name}`]
            };
        }

        const envList = envVars.map(e => {
            const targets = e.target.join(', ');
            return `- **${e.key}** (${e.type}) - ${targets}`;
        }).join('\n');

        return {
            message: `Environment variables for **${project.name}**:\n\n${envList}\n\n*Values are hidden for security.*`,
            data: envVars,
            suggestions: [`Set env var for ${project.name}`, `Deploy ${project.name}`]
        };
    }

    /**
     * Handle set environment variable command
     * Uses context to infer project if not specified
     */
    private static async handleSetEnv(
        connectionId: string,
        params?: Record<string, any>,
        context?: VercelChatContext
    ): Promise<VercelChatResponse> {
        // Use context.projectName if params.projectName is not provided
        if (!params?.projectName && context?.projectName) {
            params = { ...params, projectName: context.projectName };
        }

        if (!params?.key || !params?.value || !params?.projectName) {
            return {
                message: 'Please specify the key, value, and project. For example: "Set env API_KEY to xyz123 for my-project"',
                suggestions: ['Show my projects', 'Help with Vercel']
            };
        }

        const projects = await VercelService.getProjects(connectionId);
        const project = projects.find(p => 
            p.name.toLowerCase() === params?.projectName?.toLowerCase()
        );

        if (!project) {
            return {
                message: `I couldn't find a project named "${params.projectName}".`,
                suggestions: projects.slice(0, 5).map(p => `Set env var for ${p.name}`)
            };
        }

        await VercelService.setEnvVar(
            connectionId,
            project.id,
            params.key,
            params.value,
            ['production', 'preview', 'development'],
            'encrypted'
        );

        return {
            message: `✅ Environment variable **${params.key}** has been set for **${project.name}**!\n\nThe variable is encrypted and will be available in all environments.`,
            suggestions: [`Show env vars for ${project.name}`, `Deploy ${project.name}`]
        };
    }

    /**
     * Handle get analytics command
     * Uses context to infer project if not specified
     */
    private static async handleGetAnalytics(
        connectionId: string,
        params?: Record<string, any>,
        context?: VercelChatContext
    ): Promise<VercelChatResponse> {
        const projects = await VercelService.getProjects(connectionId);

        // Use context.projectName if params.projectName is not provided
        if (!params?.projectName && context?.projectName) {
            params = { projectName: context.projectName };
        }

        if (!params?.projectName) {
            if (projects.length === 1) {
                params = { projectName: projects[0].name };
            } else {
                return {
                    message: 'Which project\'s analytics would you like to see?',
                    suggestions: projects.slice(0, 5).map(p => `Get analytics for ${p.name}`)
                };
            }
        }

        const project = projects.find(p => 
            p.name.toLowerCase() === params?.projectName?.toLowerCase()
        );

        if (!project) {
            return {
                message: `I couldn't find a project named "${params.projectName}".`,
                suggestions: projects.slice(0, 5).map(p => `Get analytics for ${p.name}`)
            };
        }

        try {
            const analytics = await VercelService.getAnalytics(connectionId, project.id);

            return {
                message: `📊 Analytics for **${project.name}** (Last 30 days):\n\n` +
                    `- **Page Views**: ${analytics.pageViews?.toLocaleString() || 'N/A'}\n` +
                    `- **Unique Visitors**: ${analytics.visitors?.toLocaleString() || 'N/A'}\n` +
                    `- **Bandwidth**: ${analytics.bandwidth || 'N/A'}`,
                data: analytics,
                suggestions: [`Deploy ${project.name}`, `Show deployments for ${project.name}`]
            };
        } catch (error) {
            return {
                message: `Analytics may not be enabled for **${project.name}**. Enable Vercel Analytics in your project settings.`,
                suggestions: [`Show deployments for ${project.name}`, 'Show my projects']
            };
        }
    }

    /**
     * Get help response
     */
    private static getHelpResponse(): VercelChatResponse {
        return {
            message: `## Vercel Commands 🚀

Here's what I can help you with:

**Projects**
- "Show my Vercel projects"
- "Deploy [project-name]" or "Deploy [project-name] to production"

**Deployments**
- "Show deployments for [project]"
- "Get logs for [project]"
- "Rollback [project]"
- "Promote [deployment-id] to production"

**Domains**
- "Show domains for [project]"
- "Add domain example.com to [project]"

**Environment Variables**
- "Show env vars for [project]"
- "Set env API_KEY to value for [project]"

**Analytics**
- "Get analytics for [project]"

**Connection**
- "Connect Vercel" - Link your Vercel account`,
            suggestions: ['Show my projects', 'Connect Vercel', 'Deploy to production']
        };
    }

    /**
     * Generate AI response for complex queries
     */
    private static async generateAIResponse(
        message: string,
        context: VercelChatContext,
        connection?: IVercelConnection | null
    ): Promise<VercelChatResponse> {
        // Use the VercelChatContext to provide more relevant context in the prompt.
        let contextSection = '';
        if (context) {
            let parts: string[] = [];
            if (context.projectName) {
                parts.push(`The current project is "${context.projectName}".`);
            }
            if (context.deployments && Array.isArray(context.deployments) && context.deployments.length > 0) {
                parts.push(
                    `Recent deployments: ${context.deployments
                        .map((d: any) => d.name || d.id || '[deployment]')
                        .slice(0, 3)
                        .join(", ")}.`
                );
            }
            if (context.domains && Array.isArray(context.domains) && context.domains.length > 0) {
                parts.push(
                    `Connected domains: ${context.domains
                        .map((d: any) => d.name || '[domain]')
                        .slice(0, 3)
                        .join(", ")}.`
                );
            }
            if (context.envVars && Array.isArray(context.envVars) && context.envVars.length > 0) {
                parts.push(
                    `Some environment variables are set (e.g., ${context.envVars
                        .map((e: any) => e.key || '[env]')
                        .slice(0, 3)
                        .join(", ")}).`
                );
            }
            if (parts.length > 0) {
                contextSection = "\n\nHere is some current context:\n" + parts.join(' ') + '\n';
            }
        }

        const systemPrompt = `You are a helpful assistant for Vercel deployments and project management within Cost Katana.
${connection ? `The user is connected as ${connection.vercelUsername}${connection.teamSlug ? ` (Team: ${connection.teamSlug})` : ''}.` : 'The user is not connected to Vercel yet.'}
${contextSection}
You can help with:
- Deploying projects to Vercel
- Managing deployments (rollback, promote)
- Configuring domains
- Setting environment variables
- Viewing analytics

If the user asks about something you can help with, provide guidance on how to do it.
If they need to perform an action, suggest the appropriate command.`;

        try {
            const response = await AIRouterService.invokeModel(
                `${systemPrompt}\n\nUser: ${message}`,
                'anthropic.claude-3-5-haiku-20241022-v1:0'
            );

            return {
                message: response || 'I\'m not sure how to help with that. Try asking "Help with Vercel" for available commands.',
                suggestions: ['Help with Vercel', 'Show my projects', 'Connect Vercel']
            };
        } catch (error) {
            loggingService.error('AI response generation failed', { error });
            return {
                message: 'I\'m having trouble understanding that request. Here are some things I can help with:',
                suggestions: ['Help with Vercel', 'Show my projects', 'Deploy to Vercel']
            };
        }
    }
}

export default VercelChatAgentService;
