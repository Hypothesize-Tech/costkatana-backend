import { loggingService } from './logging.service';
import { VercelConnection } from '../models/VercelConnection';
import axios from 'axios';

/**
 * Vercel Official MCP Server Client
 * Connects to Vercel's hosted MCP server following the Model Context Protocol standard
 * Documentation: https://vercel.com/docs/mcp/vercel-mcp
 */

// Vercel MCP Server URL (official hosted server)
const VERCEL_MCP_SERVER_URL = 'https://mcp.vercel.com';

export interface VercelMCPTool {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: Record<string, any>;
        required?: string[];
    };
}

export interface VercelMCPRequest {
    method: string;
    params: {
        name: string;
        arguments?: Record<string, any>;
    };
}

export interface VercelMCPResponse {
    content: Array<{
        type: string;
        text?: string;
        data?: any;
    }>;
    isError?: boolean;
}

/**
 * Vercel MCP Service
 * Provides interface to Vercel's official MCP server
 */
export class VercelMCPService {
    /**
     * Available Vercel MCP Tools
     * Based on official Vercel MCP server capabilities
     */
    private static readonly AVAILABLE_TOOLS = {
        list_projects: {
            name: 'list_projects',
            description: 'List all Vercel projects for the authenticated user',
            inputSchema: {
                type: 'object',
                properties: {
                    limit: { type: 'number', description: 'Maximum number of projects to return' }
                }
            }
        },
        list_deployments: {
            name: 'list_deployments',
            description: 'List deployments for a specific project',
            inputSchema: {
                type: 'object',
                properties: {
                    projectId: { type: 'string', description: 'Project ID' },
                    limit: { type: 'number', description: 'Maximum number of deployments to return' }
                },
                required: ['projectId']
            }
        },
        get_deployment_build_logs: {
            name: 'get_deployment_build_logs',
            description: 'Get build logs for a specific deployment',
            inputSchema: {
                type: 'object',
                properties: {
                    deploymentId: { type: 'string', description: 'Deployment ID' }
                },
                required: ['deploymentId']
            }
        },
        search_vercel_documentation: {
            name: 'search_vercel_documentation',
            description: 'Search Vercel documentation',
            inputSchema: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search query' }
                },
                required: ['query']
            }
        },
        get_project_details: {
            name: 'get_project_details',
            description: 'Get detailed information about a project',
            inputSchema: {
                type: 'object',
                properties: {
                    projectId: { type: 'string', description: 'Project ID' }
                },
                required: ['projectId']
            }
        },
        get_deployment_details: {
            name: 'get_deployment_details',
            description: 'Get detailed information about a deployment',
            inputSchema: {
                type: 'object',
                properties: {
                    deploymentId: { type: 'string', description: 'Deployment ID' }
                },
                required: ['deploymentId']
            }
        }
    };

    /**
     * Call Vercel MCP tool
     */
    static async callTool(
        toolName: string,
        parameters: Record<string, any>,
        connectionId: string
    ): Promise<VercelMCPResponse> {
        try {
            // Get connection with decrypted access token
            const connection = await VercelConnection.findById(connectionId);
            if (!connection || !connection.isActive) {
                throw new Error('Vercel connection not found or inactive');
            }

            const accessToken = connection.decryptToken();

            loggingService.info('Calling Vercel MCP tool', {
                component: 'VercelMCPService',
                operation: 'callTool',
                toolName,
                connectionId
            });

            // MCP protocol request
            const mcpRequest: VercelMCPRequest = {
                method: 'tools/call',
                params: {
                    name: toolName,
                    arguments: parameters
                }
            };

            // Call Vercel MCP server
            const response = await axios.post(
                `${VERCEL_MCP_SERVER_URL}/mcp`,
                mcpRequest,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                        'User-Agent': 'CostKatana/2.0.0'
                    },
                    timeout: 30000 // 30 second timeout
                }
            );

            loggingService.info('Vercel MCP tool call successful', {
                component: 'VercelMCPService',
                operation: 'callTool',
                toolName,
                statusCode: response.status
            });

            return response.data;
        } catch (error: any) {
            loggingService.error('Vercel MCP tool call failed', {
                component: 'VercelMCPService',
                operation: 'callTool',
                toolName,
                error: error.message,
                stack: error.stack
            });

            // Handle specific errors
            if (error.response?.status === 401) {
                throw new Error('Vercel authentication failed. Please reconnect your Vercel account.');
            } else if (error.response?.status === 429) {
                throw new Error('Vercel API rate limit exceeded. Please try again later.');
            } else if (error.response?.status === 403) {
                throw new Error('Insufficient permissions. Please check your Vercel OAuth scopes.');
            }

            throw new Error(`Vercel MCP call failed: ${error.message}`);
        }
    }

    /**
     * List projects using Vercel MCP
     */
    static async listProjects(connectionId: string, limit?: number): Promise<any> {
        const response = await this.callTool(
            'list_projects',
            { limit: limit || 100 },
            connectionId
        );

        return this.extractData(response);
    }

    /**
     * List deployments using Vercel MCP
     */
    static async listDeployments(
        connectionId: string,
        projectId: string,
        limit?: number
    ): Promise<any> {
        const response = await this.callTool(
            'list_deployments',
            { projectId, limit: limit || 20 },
            connectionId
        );

        return this.extractData(response);
    }

    /**
     * Get deployment build logs using Vercel MCP
     */
    static async getDeploymentBuildLogs(
        connectionId: string,
        deploymentId: string
    ): Promise<any> {
        const response = await this.callTool(
            'get_deployment_build_logs',
            { deploymentId },
            connectionId
        );

        return this.extractData(response);
    }

    /**
     * Search Vercel documentation using Vercel MCP
     */
    static async searchDocumentation(
        connectionId: string,
        query: string
    ): Promise<any> {
        const response = await this.callTool(
            'search_vercel_documentation',
            { query },
            connectionId
        );

        return this.extractData(response);
    }

    /**
     * Get project details using Vercel MCP
     */
    static async getProjectDetails(
        connectionId: string,
        projectId: string
    ): Promise<any> {
        const response = await this.callTool(
            'get_project_details',
            { projectId },
            connectionId
        );

        return this.extractData(response);
    }

    /**
     * Get deployment details using Vercel MCP
     */
    static async getDeploymentDetails(
        connectionId: string,
        deploymentId: string
    ): Promise<any> {
        const response = await this.callTool(
            'get_deployment_details',
            { deploymentId },
            connectionId
        );

        return this.extractData(response);
    }

    /**
     * Extract data from MCP response
     */
    private static extractData(response: VercelMCPResponse): any {
        if (response.isError) {
            const errorText = response.content.find(c => c.type === 'text')?.text;
            throw new Error(errorText || 'MCP tool call failed');
        }

        // Extract data from response content
        for (const content of response.content) {
            if (content.data) {
                return content.data;
            }
            if (content.text) {
                try {
                    return JSON.parse(content.text);
                } catch {
                    return content.text;
                }
            }
        }

        return response.content;
    }

    /**
     * Get available tools
     */
    static getAvailableTools(): VercelMCPTool[] {
        return Object.values(this.AVAILABLE_TOOLS);
    }

    /**
     * Check if MCP server is available
     */
    static async checkHealth(): Promise<boolean> {
        try {
            const response = await axios.get(`${VERCEL_MCP_SERVER_URL}/health`, {
                timeout: 5000
            });
            return response.status === 200;
        } catch {
            return false;
        }
    }
}

export default VercelMCPService;
