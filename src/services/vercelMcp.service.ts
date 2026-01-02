import { loggingService } from './logging.service';
import { VercelConnection } from '../models/VercelConnection';
import axios from 'axios';

/**
 * Vercel MCP Service
 * 
 * This service provides MCP-like interface to Vercel operations.
 * It uses the direct Vercel REST API (https://api.vercel.com) for all operations.
 * 
 * Note: Vercel does not have a public hosted MCP server. The Vercel MCP server
 * (https://github.com/vercel/mcp) is designed to be run locally. This service
 * provides equivalent functionality using the REST API directly.
 */

// Vercel REST API base URL
const VERCEL_API_BASE = 'https://api.vercel.com';

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
 * Provides MCP-like interface using direct Vercel REST API
 */
export class VercelMCPService {
    /**
     * Available Vercel MCP Tools
     * Based on official Vercel API capabilities
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
        get_project_details: {
            name: 'get_project_details',
            description: 'Get detailed information about a project',
            inputSchema: {
                type: 'object',
                properties: {
                    projectId: { type: 'string', description: 'Project ID or name' }
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
        },
        list_domains: {
            name: 'list_domains',
            description: 'List domains for a project',
            inputSchema: {
                type: 'object',
                properties: {
                    projectId: { type: 'string', description: 'Project ID' }
                },
                required: ['projectId']
            }
        },
        list_env_vars: {
            name: 'list_env_vars',
            description: 'List environment variables for a project',
            inputSchema: {
                type: 'object',
                properties: {
                    projectId: { type: 'string', description: 'Project ID' }
                },
                required: ['projectId']
            }
        },
        trigger_deployment: {
            name: 'trigger_deployment',
            description: 'Trigger a new deployment for a project',
            inputSchema: {
                type: 'object',
                properties: {
                    projectId: { type: 'string', description: 'Project ID or name' },
                    target: { type: 'string', description: 'Deployment target (production or preview)' }
                },
                required: ['projectId']
            }
        }
    };

    /**
     * Get connection with decrypted access token
     */
    private static async getConnection(connectionId: string): Promise<{
        connection: any;
        accessToken: string;
        teamId?: string;
    }> {
            const connection = await VercelConnection.findById(connectionId).select('+accessToken');
            if (!connection || !connection.isActive) {
                throw new Error('Vercel connection not found or inactive');
            }

            const accessToken = connection.decryptToken();
        return {
            connection,
            accessToken,
            teamId: connection.teamId
        };
    }

    /**
     * Make authenticated API request to Vercel
     */
    private static async apiRequest<T>(
        accessToken: string,
        endpoint: string,
        teamId?: string,
        options: RequestInit = {}
    ): Promise<T> {
        // Build URL with team parameter if applicable
        let url = `${VERCEL_API_BASE}${endpoint}`;
        if (teamId) {
            const separator = endpoint.includes('?') ? '&' : '?';
            url = `${url}${separator}teamId=${teamId}`;
        }

        loggingService.info('Making Vercel API request', {
                component: 'VercelMCPService',
            operation: 'apiRequest',
            endpoint,
            method: options.method || 'GET',
            hasTeamId: !!teamId
        });

        const response = await axios({
            url,
            method: (options.method || 'GET') as any,
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                        'User-Agent': 'CostKatana/2.0.0'
                    },
            data: options.body ? JSON.parse(options.body as string) : undefined,
            timeout: 30000
        });

        loggingService.info('Vercel API response received', {
            component: 'VercelMCPService',
            operation: 'apiRequest',
            endpoint,
            status: response.status
        });

        return response.data;
    }

    /**
     * List projects using Vercel REST API
     */
    static async listProjects(connectionId: string, limit?: number): Promise<any[]> {
        try {
            const { accessToken, teamId } = await this.getConnection(connectionId);

            loggingService.info('Listing Vercel projects', {
                component: 'VercelMCPService',
                operation: 'listProjects',
                connectionId,
                limit
            });

            const limitParam = limit ? `?limit=${limit}` : '?limit=100';
            const data = await this.apiRequest<{ projects: any[] }>(
                accessToken,
                `/v9/projects${limitParam}`,
                teamId
            );

            loggingService.info('Vercel projects listed successfully', {
                component: 'VercelMCPService',
                operation: 'listProjects',
                connectionId,
                projectCount: data.projects?.length || 0
            });

            return data.projects || [];
        } catch (error: any) {
            loggingService.error('Failed to list Vercel projects', {
                component: 'VercelMCPService',
                operation: 'listProjects',
                connectionId,
                error: error.message
            });
            this.handleApiError(error);
            throw error;
        }
    }

    /**
     * List deployments using Vercel REST API
     */
    static async listDeployments(
        connectionId: string,
        projectId: string,
        limit?: number
    ): Promise<any[]> {
        try {
            const { accessToken, teamId } = await this.getConnection(connectionId);

            loggingService.info('Listing Vercel deployments', {
                component: 'VercelMCPService',
                operation: 'listDeployments',
                connectionId,
                projectId,
                limit
            });

            const limitVal = limit || 20;
            const data = await this.apiRequest<{ deployments: any[] }>(
                accessToken,
                `/v6/deployments?projectId=${projectId}&limit=${limitVal}`,
                teamId
            );

            loggingService.info('Vercel deployments listed successfully', {
                component: 'VercelMCPService',
                operation: 'listDeployments',
                connectionId,
                projectId,
                deploymentCount: data.deployments?.length || 0
            });

            return data.deployments || [];
        } catch (error: any) {
            loggingService.error('Failed to list Vercel deployments', {
                component: 'VercelMCPService',
                operation: 'listDeployments',
                connectionId,
                projectId,
                error: error.message
            });
            this.handleApiError(error);
            throw error;
        }
    }

    /**
     * Get deployment build logs using Vercel REST API
     */
    static async getDeploymentBuildLogs(
        connectionId: string,
        deploymentId: string
    ): Promise<any[]> {
        try {
            const { accessToken, teamId } = await this.getConnection(connectionId);

            loggingService.info('Getting Vercel deployment logs', {
                component: 'VercelMCPService',
                operation: 'getDeploymentBuildLogs',
                connectionId,
                deploymentId
            });

            const data = await this.apiRequest<{ logs?: Array<{ text: string; created: number }> }>(
                accessToken,
                `/v2/deployments/${deploymentId}/events`,
                teamId
            );

            const logs = data.logs?.map(log => log.text) || [];

            loggingService.info('Vercel deployment logs retrieved successfully', {
                component: 'VercelMCPService',
                operation: 'getDeploymentBuildLogs',
                connectionId,
                deploymentId,
                logCount: logs.length
            });

            return logs;
        } catch (error: any) {
            loggingService.error('Failed to get Vercel deployment logs', {
                component: 'VercelMCPService',
                operation: 'getDeploymentBuildLogs',
                connectionId,
                deploymentId,
                error: error.message
            });
            this.handleApiError(error);
            throw error;
        }
    }

    /**
     * Get project details using Vercel REST API
     */
    static async getProjectDetails(
        connectionId: string,
        projectId: string
    ): Promise<any> {
        try {
            const { accessToken, teamId } = await this.getConnection(connectionId);

            loggingService.info('Getting Vercel project details', {
                component: 'VercelMCPService',
                operation: 'getProjectDetails',
                connectionId,
                projectId
            });

            const project = await this.apiRequest<any>(
                accessToken,
                `/v9/projects/${projectId}`,
                teamId
            );

            loggingService.info('Vercel project details retrieved successfully', {
                component: 'VercelMCPService',
                operation: 'getProjectDetails',
                connectionId,
                projectId,
                projectName: project.name
            });

            return project;
        } catch (error: any) {
            loggingService.error('Failed to get Vercel project details', {
                component: 'VercelMCPService',
                operation: 'getProjectDetails',
                connectionId,
                projectId,
                error: error.message
            });
            this.handleApiError(error);
            throw error;
        }
    }

    /**
     * Get deployment details using Vercel REST API
     */
    static async getDeploymentDetails(
        connectionId: string,
        deploymentId: string
    ): Promise<any> {
        try {
            const { accessToken, teamId } = await this.getConnection(connectionId);

            loggingService.info('Getting Vercel deployment details', {
                component: 'VercelMCPService',
                operation: 'getDeploymentDetails',
                connectionId,
                deploymentId
            });

            const deployment = await this.apiRequest<any>(
                accessToken,
                `/v13/deployments/${deploymentId}`,
                teamId
            );

            loggingService.info('Vercel deployment details retrieved successfully', {
                component: 'VercelMCPService',
                operation: 'getDeploymentDetails',
                connectionId,
                deploymentId,
                deploymentState: deployment.state
            });

            return deployment;
        } catch (error: any) {
            loggingService.error('Failed to get Vercel deployment details', {
                component: 'VercelMCPService',
                operation: 'getDeploymentDetails',
                connectionId,
                deploymentId,
                error: error.message
            });
            this.handleApiError(error);
            throw error;
        }
    }

    /**
     * List domains for a project using Vercel REST API
     */
    static async listDomains(
        connectionId: string,
        projectId: string
    ): Promise<any[]> {
        try {
            const { accessToken, teamId } = await this.getConnection(connectionId);

            loggingService.info('Listing Vercel domains', {
                component: 'VercelMCPService',
                operation: 'listDomains',
                connectionId,
                projectId
            });

            const data = await this.apiRequest<{ domains: any[] }>(
                accessToken,
                `/v9/projects/${projectId}/domains`,
                teamId
            );

            loggingService.info('Vercel domains listed successfully', {
                component: 'VercelMCPService',
                operation: 'listDomains',
                connectionId,
                projectId,
                domainCount: data.domains?.length || 0
            });

            return data.domains || [];
        } catch (error: any) {
            loggingService.error('Failed to list Vercel domains', {
                component: 'VercelMCPService',
                operation: 'listDomains',
                connectionId,
                projectId,
                error: error.message
            });
            this.handleApiError(error);
            throw error;
        }
    }

    /**
     * List environment variables for a project using Vercel REST API
     */
    static async listEnvVars(
        connectionId: string,
        projectId: string
    ): Promise<any[]> {
        try {
            const { accessToken, teamId } = await this.getConnection(connectionId);

            loggingService.info('Listing Vercel environment variables', {
                component: 'VercelMCPService',
                operation: 'listEnvVars',
                connectionId,
                projectId
            });

            const data = await this.apiRequest<{ envs: any[] }>(
                accessToken,
                `/v9/projects/${projectId}/env`,
                teamId
            );

            // Strip values for security
            const envVars = (data.envs || []).map(env => ({
                ...env,
                value: undefined
            }));

            loggingService.info('Vercel environment variables listed successfully', {
                component: 'VercelMCPService',
                operation: 'listEnvVars',
                connectionId,
                projectId,
                envVarCount: envVars.length
            });

            return envVars;
        } catch (error: any) {
            loggingService.error('Failed to list Vercel environment variables', {
                component: 'VercelMCPService',
                operation: 'listEnvVars',
                connectionId,
                projectId,
                error: error.message
            });
            this.handleApiError(error);
            throw error;
        }
    }

    /**
     * Set environment variable using Vercel REST API
     */
    static async setEnvVar(
        connectionId: string,
        projectId: string,
        key: string,
        value: string,
        target: Array<'production' | 'preview' | 'development'> = ['production', 'preview', 'development'],
        type: 'plain' | 'secret' | 'encrypted' = 'encrypted'
    ): Promise<any> {
        try {
            const { accessToken, teamId } = await this.getConnection(connectionId);

            loggingService.info('Setting Vercel environment variable', {
                component: 'VercelMCPService',
                operation: 'setEnvVar',
                connectionId,
                projectId,
                key,
                target,
                type
            });

            // Check if env var exists
            const existingEnvs = await this.apiRequest<{ envs: any[] }>(
                accessToken,
                `/v9/projects/${projectId}/env`,
                teamId
            );
            const existing = existingEnvs.envs?.find(e => e.key === key);

            let result: any;
            if (existing) {
                // Update existing
                result = await this.apiRequest<any>(
                    accessToken,
                    `/v9/projects/${projectId}/env/${existing.id}`,
                    teamId,
                    {
                        method: 'PATCH',
                        body: JSON.stringify({ value, target, type })
                    }
                );
            } else {
                // Create new
                result = await this.apiRequest<any>(
                    accessToken,
                    `/v10/projects/${projectId}/env`,
                    teamId,
                    {
                        method: 'POST',
                        body: JSON.stringify({ key, value, target, type })
                    }
                );
            }

            loggingService.info('Vercel environment variable set successfully', {
                component: 'VercelMCPService',
                operation: 'setEnvVar',
                connectionId,
                projectId,
                key,
                isUpdate: !!existing
            });

            return result;
        } catch (error: any) {
            loggingService.error('Failed to set Vercel environment variable', {
                component: 'VercelMCPService',
                operation: 'setEnvVar',
                connectionId,
                projectId,
                key,
                error: error.message
            });
            this.handleApiError(error);
            throw error;
        }
    }

    /**
     * Trigger deployment using Vercel REST API
     */
    static async triggerDeployment(
        connectionId: string,
        projectId: string,
        target: 'production' | 'preview' = 'preview'
    ): Promise<any> {
        try {
            const { accessToken, teamId } = await this.getConnection(connectionId);

            loggingService.info('Triggering Vercel deployment', {
                component: 'VercelMCPService',
                operation: 'triggerDeployment',
                connectionId,
                projectId,
                target
            });

            // Get project details first to get the name
            const project = await this.apiRequest<any>(
                accessToken,
                `/v9/projects/${projectId}`,
                teamId
            );

            const deployment = await this.apiRequest<any>(
                accessToken,
                '/v13/deployments',
                teamId,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        name: project.name,
                        target
                    })
                }
            );

            loggingService.info('Vercel deployment triggered successfully', {
                component: 'VercelMCPService',
                operation: 'triggerDeployment',
                connectionId,
                projectId,
                deploymentId: deployment.uid,
                target
            });

            return deployment;
        } catch (error: any) {
            loggingService.error('Failed to trigger Vercel deployment', {
                component: 'VercelMCPService',
                operation: 'triggerDeployment',
                connectionId,
                projectId,
                error: error.message
            });
            this.handleApiError(error);
            throw error;
        }
    }

    /**
     * Rollback deployment using Vercel REST API
     */
    static async rollbackDeployment(
        connectionId: string,
        projectId: string,
        deploymentId: string
    ): Promise<any> {
        try {
            const { accessToken, teamId } = await this.getConnection(connectionId);

            loggingService.info('Rolling back Vercel deployment', {
                component: 'VercelMCPService',
                operation: 'rollbackDeployment',
                connectionId,
                projectId,
                deploymentId
            });

            // Get deployment details
            const deployment = await this.apiRequest<any>(
                accessToken,
                `/v13/deployments/${deploymentId}`,
                teamId
            );

            // Promote the old deployment to production
            const result = await this.apiRequest<any>(
                accessToken,
                `/v10/projects/${deployment.name}/promote/${deploymentId}`,
                teamId,
                { method: 'POST' }
            );

            loggingService.info('Vercel deployment rolled back successfully', {
                component: 'VercelMCPService',
                operation: 'rollbackDeployment',
                connectionId,
                projectId,
                deploymentId
            });

            return result;
        } catch (error: any) {
            loggingService.error('Failed to rollback Vercel deployment', {
                component: 'VercelMCPService',
                operation: 'rollbackDeployment',
                connectionId,
                projectId,
                deploymentId,
                error: error.message
            });
            this.handleApiError(error);
            throw error;
        }
    }

    /**
     * Add domain to project using Vercel REST API
     */
    static async addDomain(
        connectionId: string,
        projectId: string,
        domain: string
    ): Promise<any> {
        try {
            const { accessToken, teamId } = await this.getConnection(connectionId);

            loggingService.info('Adding domain to Vercel project', {
                component: 'VercelMCPService',
                operation: 'addDomain',
                connectionId,
                projectId,
                domain
            });

            const result = await this.apiRequest<any>(
                accessToken,
                `/v10/projects/${projectId}/domains`,
                teamId,
                {
                    method: 'POST',
                    body: JSON.stringify({ name: domain })
                }
            );

            loggingService.info('Domain added to Vercel project successfully', {
                component: 'VercelMCPService',
                operation: 'addDomain',
                connectionId,
                projectId,
                domain
            });

            return result;
        } catch (error: any) {
            loggingService.error('Failed to add domain to Vercel project', {
                component: 'VercelMCPService',
                operation: 'addDomain',
                connectionId,
                projectId,
                domain,
                error: error.message
            });
            this.handleApiError(error);
            throw error;
            }
    }

    /**
     * Remove domain from project using Vercel REST API
     */
    static async removeDomain(
        connectionId: string,
        projectId: string,
        domain: string
    ): Promise<void> {
                try {
            const { accessToken, teamId } = await this.getConnection(connectionId);

            loggingService.info('Removing domain from Vercel project', {
                component: 'VercelMCPService',
                operation: 'removeDomain',
                connectionId,
                projectId,
                domain
            });

            await this.apiRequest<any>(
                accessToken,
                `/v9/projects/${projectId}/domains/${domain}`,
                teamId,
                { method: 'DELETE' }
            );

            loggingService.info('Domain removed from Vercel project successfully', {
                component: 'VercelMCPService',
                operation: 'removeDomain',
                connectionId,
                projectId,
                domain
            });
        } catch (error: any) {
            loggingService.error('Failed to remove domain from Vercel project', {
                component: 'VercelMCPService',
                operation: 'removeDomain',
                connectionId,
                projectId,
                domain,
                error: error.message
            });
            this.handleApiError(error);
            throw error;
                }
            }

    /**
     * Handle API errors with appropriate messages
     */
    private static handleApiError(error: any): void {
        if (error.response?.status === 401) {
            throw new Error('Vercel authentication failed. Please reconnect your Vercel account.');
        } else if (error.response?.status === 429) {
            throw new Error('Vercel API rate limit exceeded. Please try again later.');
        } else if (error.response?.status === 403) {
            throw new Error('Insufficient permissions. Please check your Vercel OAuth scopes.');
        } else if (error.response?.status === 404) {
            throw new Error('Resource not found. Please check the project or deployment ID.');
        }
    }

    /**
     * Get available tools
     */
    static getAvailableTools(): VercelMCPTool[] {
        return Object.values(this.AVAILABLE_TOOLS);
    }

    /**
     * Check if Vercel API is accessible
     */
    static async checkHealth(connectionId: string): Promise<boolean> {
        try {
            const { accessToken, teamId } = await this.getConnection(connectionId);
            await this.apiRequest<any>(accessToken, '/v2/user', teamId);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Search Vercel documentation (static - no API call needed)
     * Returns helpful documentation links based on query
     */
    static async searchDocumentation(
        _connectionId: string,
        query: string
    ): Promise<any[]> {
        // This is a static helper that returns documentation links
        // Vercel doesn't have a documentation search API
        const docs: Record<string, { title: string; url: string }[]> = {
            deploy: [
                { title: 'Deployments Overview', url: 'https://vercel.com/docs/deployments/overview' },
                { title: 'Deploy Button', url: 'https://vercel.com/docs/deploy-button' }
            ],
            domain: [
                { title: 'Custom Domains', url: 'https://vercel.com/docs/projects/domains' },
                { title: 'DNS Configuration', url: 'https://vercel.com/docs/projects/domains/dns' }
            ],
            env: [
                { title: 'Environment Variables', url: 'https://vercel.com/docs/projects/environment-variables' }
            ],
            project: [
                { title: 'Projects Overview', url: 'https://vercel.com/docs/projects/overview' }
            ],
            analytics: [
                { title: 'Analytics', url: 'https://vercel.com/docs/analytics' }
            ]
        };

        const lowerQuery = query.toLowerCase();
        const results: { title: string; url: string }[] = [];

        for (const [key, docList] of Object.entries(docs)) {
            if (lowerQuery.includes(key)) {
                results.push(...docList);
            }
        }

        // If no specific matches, return general docs
        if (results.length === 0) {
            results.push(
                { title: 'Vercel Documentation', url: 'https://vercel.com/docs' },
                { title: 'Vercel API Reference', url: 'https://vercel.com/docs/rest-api' }
            );
        }

        return results;
    }
}

export default VercelMCPService;
