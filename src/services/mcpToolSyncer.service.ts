/**
 * MCP Tool Syncer Service
 * Syncs MCP tool definitions to file-based registry
 */

import { loggingService } from './logging.service';
import { toolRegistryService } from './toolRegistry.service';
import { ToolDefinition, ToolSyncResult } from '../types/contextFile.types';
import { Tool as MCPTool } from '@modelcontextprotocol/sdk/types.js';

export class MCPToolSyncerService {
    private static instance: MCPToolSyncerService;

    private constructor() {
        loggingService.info('MCP Tool Syncer Service initialized');
    }

    static getInstance(): MCPToolSyncerService {
        if (!MCPToolSyncerService.instance) {
            MCPToolSyncerService.instance = new MCPToolSyncerService();
        }
        return MCPToolSyncerService.instance;
    }

    /**
     * Sync MongoDB MCP tools to file registry
     */
    async syncMongoDBTools(mcpTools: MCPTool[]): Promise<ToolSyncResult> {
        loggingService.info('Syncing MongoDB MCP tools', {
            toolCount: mcpTools.length
        });

        const toolDefinitions: ToolDefinition[] = mcpTools.map(mcpTool => ({
            name: mcpTool.name,
            description: mcpTool.description,
            category: 'mongodb',
            inputSchema: mcpTool.inputSchema,
            status: 'active',
            metadata: {
                provider: 'mongodb',
                version: '1.0.0',
                lastSynced: new Date()
            }
        }));

        return await toolRegistryService.registerTools(toolDefinitions);
    }

    /**
     * Sync Vercel tools to file registry
     */
    async syncVercelTools(vercelTools: Array<{
        name: string;
        description: string;
        inputSchema: any;
    }>): Promise<ToolSyncResult> {
        loggingService.info('Syncing Vercel tools', {
            toolCount: vercelTools.length
        });

        const toolDefinitions: ToolDefinition[] = vercelTools.map(tool => ({
            name: tool.name,
            description: tool.description,
            category: 'vercel',
            inputSchema: tool.inputSchema,
            status: 'active',
            metadata: {
                provider: 'vercel',
                version: '1.0.0',
                lastSynced: new Date()
            }
        }));

        return await toolRegistryService.registerTools(toolDefinitions);
    }

    /**
     * Sync AWS integration tools
     */
    async syncAWSTools(awsTools: Array<{
        name: string;
        description: string;
        inputSchema: any;
    }>): Promise<ToolSyncResult> {
        loggingService.info('Syncing AWS tools', {
            toolCount: awsTools.length
        });

        const toolDefinitions: ToolDefinition[] = awsTools.map(tool => ({
            name: tool.name,
            description: tool.description,
            category: 'aws',
            inputSchema: tool.inputSchema,
            status: 'active',
            metadata: {
                provider: 'aws',
                version: '1.0.0',
                lastSynced: new Date()
            }
        }));

        return await toolRegistryService.registerTools(toolDefinitions);
    }

    /**
     * Sync core agent tools (analytics, optimization, etc.)
     */
    async syncCoreTools(): Promise<ToolSyncResult> {
        loggingService.info('Syncing core agent tools');

        const coreTools: ToolDefinition[] = [
            {
                name: 'knowledge_base_search',
                description: 'Search the knowledge base for documentation, guides, and best practices about CostKatana features',
                category: 'analytics',
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: { type: 'string', description: 'Search query' },
                        limit: { type: 'number', description: 'Maximum results to return' }
                    },
                    required: ['query']
                },
                status: 'active',
                metadata: {
                    provider: 'costkatana',
                    version: '1.0.0'
                }
            },
            {
                name: 'analytics_manager',
                description: 'Analyze usage patterns, costs, tokens, and generate analytics reports',
                category: 'analytics',
                inputSchema: {
                    type: 'object',
                    properties: {
                        operation: { 
                            type: 'string', 
                            enum: ['dashboard', 'token_usage', 'model_performance', 'usage_patterns', 
                                   'cost_trends', 'user_stats', 'project_analytics', 'anomaly_detection', 
                                   'forecasting', 'comparative_analysis'],
                            description: 'Type of analytics operation'
                        },
                        userId: { type: 'string', description: 'User ID' },
                        timeframe: { type: 'string', description: 'Time period for analysis' }
                    },
                    required: ['operation', 'userId']
                },
                status: 'active',
                metadata: {
                    provider: 'costkatana',
                    version: '1.0.0'
                }
            },
            {
                name: 'optimization_manager',
                description: 'Provide cost optimization recommendations and strategies',
                category: 'analytics',
                inputSchema: {
                    type: 'object',
                    properties: {
                        userId: { type: 'string', description: 'User ID' },
                        analysisType: { 
                            type: 'string', 
                            enum: ['cost', 'performance', 'usage'],
                            description: 'Type of optimization analysis'
                        }
                    },
                    required: ['userId']
                },
                status: 'active',
                metadata: {
                    provider: 'costkatana',
                    version: '1.0.0'
                }
            },
            {
                name: 'model_selector',
                description: 'Select and recommend the best AI models based on cost and performance criteria',
                category: 'analytics',
                inputSchema: {
                    type: 'object',
                    properties: {
                        task: { type: 'string', description: 'Task description' },
                        priority: { 
                            type: 'string', 
                            enum: ['cost', 'performance', 'balanced'],
                            description: 'Optimization priority'
                        }
                    },
                    required: ['task']
                },
                status: 'active',
                metadata: {
                    provider: 'costkatana',
                    version: '1.0.0'
                }
            },
            {
                name: 'project_manager',
                description: 'Manage projects, create new projects, and handle project-related operations',
                category: 'analytics',
                inputSchema: {
                    type: 'object',
                    properties: {
                        operation: { 
                            type: 'string', 
                            enum: ['list', 'create', 'update', 'delete', 'get'],
                            description: 'Project operation'
                        },
                        userId: { type: 'string', description: 'User ID' },
                        projectId: { type: 'string', description: 'Project ID (for specific operations)' }
                    },
                    required: ['operation', 'userId']
                },
                status: 'active',
                metadata: {
                    provider: 'costkatana',
                    version: '1.0.0'
                }
            },
            {
                name: 'web_search',
                description: 'Search the web for external information and current data',
                category: 'analytics',
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: { type: 'string', description: 'Search query' },
                        maxResults: { type: 'number', description: 'Maximum results' }
                    },
                    required: ['query']
                },
                status: 'active',
                metadata: {
                    provider: 'costkatana',
                    version: '1.0.0'
                }
            }
        ];

        return await toolRegistryService.registerTools(coreTools);
    }

    /**
     * Sync all tools at once
     */
    async syncAllTools(toolsData: {
        mongodb?: MCPTool[];
        vercel?: Array<{ name: string; description: string; inputSchema: any }>;
        aws?: Array<{ name: string; description: string; inputSchema: any }>;
    }): Promise<{
        mongodb?: ToolSyncResult;
        vercel?: ToolSyncResult;
        aws?: ToolSyncResult;
        core: ToolSyncResult;
        overall: {
            success: boolean;
            totalToolsWritten: number;
            totalErrors: number;
        };
    }> {
        const results: any = {};
        let totalToolsWritten = 0;
        let totalErrors = 0;

        // Sync MongoDB tools if provided
        if (toolsData.mongodb) {
            results.mongodb = await this.syncMongoDBTools(toolsData.mongodb);
            totalToolsWritten += results.mongodb.toolsWritten;
            totalErrors += results.mongodb.errors.length;
        }

        // Sync Vercel tools if provided
        if (toolsData.vercel) {
            results.vercel = await this.syncVercelTools(toolsData.vercel);
            totalToolsWritten += results.vercel.toolsWritten;
            totalErrors += results.vercel.errors.length;
        }

        // Sync AWS tools if provided
        if (toolsData.aws) {
            results.aws = await this.syncAWSTools(toolsData.aws);
            totalToolsWritten += results.aws.toolsWritten;
            totalErrors += results.aws.errors.length;
        }

        // Always sync core tools
        results.core = await this.syncCoreTools();
        totalToolsWritten += results.core.toolsWritten;
        totalErrors += results.core.errors.length;

        results.overall = {
            success: totalErrors === 0,
            totalToolsWritten,
            totalErrors
        };

        loggingService.info('Tool sync completed', results.overall);

        return results;
    }
}

// Export singleton instance
export const mcpToolSyncerService = MCPToolSyncerService.getInstance();
