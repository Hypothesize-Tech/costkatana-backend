/**
 * Vercel MCP Server
 * Full CRUD operations for Vercel integration
 */

import { BaseIntegrationMCP } from './base-integration.mcp';
import { createToolSchema, createParameter, CommonParameters } from '../registry/tool-metadata';

const VERCEL_API_BASE = 'https://api.vercel.com';

export class VercelMCP extends BaseIntegrationMCP {
  constructor() {
    super('vercel', '1.0.0');
  }

  registerTools(): void {
    // ===== PROJECT OPERATIONS =====
    
    // List projects
    this.registerTool(
      createToolSchema(
        'vercel_list_projects',
        'vercel',
        'List all Vercel projects',
        'GET',
        [
          createParameter('limit', 'number', 'Maximum number of projects to return', { default: 20 }),
          createParameter('search', 'string', 'Search query for project names', { required: false }),
        ],
        { requiredScopes: ['projects:read'] }
      ),
      async (params, context) => {
        const queryParams: any = { limit: params.limit || 20 };
        if (params.search) {
          queryParams.search = params.search;
        }

        const data = await this.makeRequest(
          context.connectionId,
          'GET',
          `${VERCEL_API_BASE}/v9/projects`,
          { params: queryParams, timeout: 300000 } // 30 second timeout
        );

        return {
          projects: data.projects || [],
          count: data.projects?.length || 0,
          pagination: data.pagination,
        };
      }
    );

    // Get project
    this.registerTool(
      createToolSchema(
        'vercel_get_project',
        'vercel',
        'Get details of a specific Vercel project',
        'GET',
        [CommonParameters.projectId],
        { requiredScopes: ['projects:read'] }
      ),
      async (params, context) => {
        const data = await this.makeRequest(
          context.connectionId,
          'GET',
          `${VERCEL_API_BASE}/v9/projects/${params.projectId}`,
          { timeout: 500000 } // 5 min timeout for deployment cancellation
        );

        return data;
      }
    );

    // Create project
    this.registerTool(
      createToolSchema(
        'vercel_create_project',
        'vercel',
        'Create a new Vercel project',
        'POST',
        [
          CommonParameters.projectName,
          createParameter('framework', 'string', 'Framework preset (nextjs, vite, etc)', { required: false }),
          createParameter('gitRepository', 'object', 'Git repository configuration', { required: false }),
          createParameter('environmentVariables', 'array', 'Environment variables', { required: false }),
        ],
        { requiredScopes: ['projects:write'] }
      ),
      async (params, context) => {
        const body: any = {
          name: params.projectName,
        };

        if (params.framework) {
          body.framework = params.framework;
        }

        if (params.gitRepository) {
          body.gitRepository = params.gitRepository;
        }

        if (params.environmentVariables) {
          body.environmentVariables = params.environmentVariables;
        }

        const data = await this.makeRequest(
          context.connectionId,
          'POST',
          `${VERCEL_API_BASE}/v9/projects`,
          { body, timeout: 500000 } // 5 min timeout for project creation
        );

        return data;
      }
    );

    // Update project
    this.registerTool(
      createToolSchema(
        'vercel_update_project',
        'vercel',
        'Update an existing Vercel project',
        'PATCH',
        [
          CommonParameters.projectId,
          createParameter('name', 'string', 'New project name', { required: false }),
          createParameter('framework', 'string', 'Framework preset', { required: false }),
          createParameter('buildCommand', 'string', 'Custom build command', { required: false }),
          createParameter('outputDirectory', 'string', 'Output directory', { required: false }),
        ],
        { requiredScopes: ['projects:write'] }
      ),
      async (params, context) => {
        const { projectId, ...updates } = params;
        
        const data = await this.makeRequest(
          context.connectionId,
          'PATCH',
          `${VERCEL_API_BASE}/v9/projects/${projectId}`,
          { body: updates, timeout: 30000 } // 30 second timeout
        );

        return data;
      }
    );

    // Delete project
    this.registerTool(
      createToolSchema(
        'vercel_delete_project',
        'vercel',
        'Delete a Vercel project',
        'DELETE',
        [CommonParameters.projectId],
        { 
          requiredScopes: ['projects:delete'],
          dangerous: true,
        }
      ),
      async (params, context) => {
        await this.makeRequest(
          context.connectionId,
          'DELETE',
          `${VERCEL_API_BASE}/v9/projects/${params.projectId}`,
          { timeout: 500000 } // 5 min timeout for deployment cancellation
        );

        return {
          success: true,
          message: `Project ${params.projectId} deleted successfully`,
        };
      }
    );

    // ===== DEPLOYMENT OPERATIONS =====

    // List deployments
    this.registerTool(
      createToolSchema(
        'vercel_list_deployments',
        'vercel',
        'List deployments for a project',
        'GET',
        [
          CommonParameters.projectId,
          CommonParameters.limit,
          createParameter('state', 'string', 'Filter by deployment state', {
            required: false,
            enum: ['BUILDING', 'ERROR', 'INITIALIZING', 'QUEUED', 'READY', 'CANCELED'],
          }),
        ],
        { requiredScopes: ['deployments:read'] }
      ),
      async (params, context) => {
        const queryParams: any = {
          projectId: params.projectId,
          limit: params.limit || 20,
        };
        
        if (params.state) {
          queryParams.state = params.state;
        }

        const data = await this.makeRequest(
          context.connectionId,
          'GET',
          `${VERCEL_API_BASE}/v6/deployments`,
          { params: queryParams, timeout: 30000 } // 30 second timeout
        );

        return {
          deployments: data.deployments || [],
          count: data.deployments?.length || 0,
          pagination: data.pagination,
        };
      }
    );

    // Get deployment
    this.registerTool(
      createToolSchema(
        'vercel_get_deployment',
        'vercel',
        'Get details of a specific deployment',
        'GET',
        [CommonParameters.deploymentId],
        { requiredScopes: ['deployments:read'] }
      ),
      async (params, context) => {
        const data = await this.makeRequest(
          context.connectionId,
          'GET',
          `${VERCEL_API_BASE}/v13/deployments/${params.deploymentId}`,
          { timeout: 500000 } // 5 min timeout for deployment cancellation
        );

        return data;
      }
    );

    // Create deployment
    this.registerTool(
      createToolSchema(
        'vercel_create_deployment',
        'vercel',
        'Create a new deployment',
        'POST',
        [
          CommonParameters.projectName,
          createParameter('gitSource', 'object', 'Git source information', { required: false }),
          createParameter('target', 'string', 'Deployment target', {
            required: false,
            enum: ['production', 'preview'],
            default: 'preview',
          }),
        ],
        { requiredScopes: ['deployments:write'] }
      ),
      async (params, context) => {
        const body: any = {
          name: params.projectName,
          target: params.target || 'preview',
        };

        if (params.gitSource) {
          body.gitSource = params.gitSource;
        }

        const data = await this.makeRequest(
          context.connectionId,
          'POST',
          `${VERCEL_API_BASE}/v13/deployments`,
          { body, timeout: 60000 } // 60 second timeout for deployment creation
        );

        return data;
      }
    );

    // Rollback deployment (cancel)
    this.registerTool(
      createToolSchema(
        'vercel_rollback_deployment',
        'vercel',
        'Rollback (cancel) a deployment',
        'POST',
        [CommonParameters.deploymentId],
        { requiredScopes: ['deployments:write'] }
      ),
      async (params, context) => {
        await this.makeRequest(
          context.connectionId,
          'PATCH',
          `${VERCEL_API_BASE}/v13/deployments/${params.deploymentId}/cancel`,
          { timeout: 500000 } // 5 min timeout for deployment cancellation
        );

        return {
          success: true,
          message: `Deployment ${params.deploymentId} cancelled`,
        };
      }
    );

    // ===== DOMAIN OPERATIONS =====

    // List domains
    this.registerTool(
      createToolSchema(
        'vercel_list_domains',
        'vercel',
        'List domains for a project',
        'GET',
        [CommonParameters.projectId],
        { requiredScopes: ['domains:read'] }
      ),
      async (params, context) => {
        const data = await this.makeRequest(
          context.connectionId,
          'GET',
          `${VERCEL_API_BASE}/v9/projects/${params.projectId}/domains`,
          { timeout: 500000 } // 5 min timeout for deployment cancellation
        );

        return {
          domains: data.domains || [],
          count: data.domains?.length || 0,
        };
      }
    );

    // Add domain
    this.registerTool(
      createToolSchema(
        'vercel_add_domain',
        'vercel',
        'Add a domain to a project',
        'POST',
        [
          CommonParameters.projectId,
          createParameter('domain', 'string', 'Domain name to add', { required: true }),
          createParameter('redirect', 'string', 'Redirect domain', { required: false }),
        ],
        { requiredScopes: ['domains:write'] }
      ),
      async (params, context) => {
        const body: any = {
          name: params.domain,
        };

        if (params.redirect) {
          body.redirect = params.redirect;
        }

        const data = await this.makeRequest(
          context.connectionId,
          'POST',
          `${VERCEL_API_BASE}/v9/projects/${params.projectId}/domains`,
          { body, timeout: 30000 } // 30 second timeout
        );

        return data;
      }
    );

    // Remove domain
    this.registerTool(
      createToolSchema(
        'vercel_remove_domain',
        'vercel',
        'Remove a domain from a project',
        'DELETE',
        [
          CommonParameters.projectId,
          createParameter('domain', 'string', 'Domain name to remove', { required: true }),
        ],
        { 
          requiredScopes: ['domains:write'],
          dangerous: true,
        }
      ),
      async (params, context) => {
        await this.makeRequest(
          context.connectionId,
          'DELETE',
          `${VERCEL_API_BASE}/v9/projects/${params.projectId}/domains/${params.domain}`,
          { timeout: 500000 } // 5 min timeout for deployment cancellation
        );

        return {
          success: true,
          message: `Domain ${params.domain} removed from project`,
        };
      }
    );

    // ===== ENVIRONMENT VARIABLE OPERATIONS =====

    // List environment variables
    this.registerTool(
      createToolSchema(
        'vercel_list_env_vars',
        'vercel',
        'List environment variables for a project',
        'GET',
        [CommonParameters.projectId],
        { requiredScopes: ['env:read'] }
      ),
      async (params, context) => {
        const data = await this.makeRequest(
          context.connectionId,
          'GET',
          `${VERCEL_API_BASE}/v9/projects/${params.projectId}/env`,
          { timeout: 500000 } // 5 min timeout for deployment cancellation
        );

        return {
          envs: data.envs || [],
          count: data.envs?.length || 0,
        };
      }
    );

    // Set environment variable
    this.registerTool(
      createToolSchema(
        'vercel_set_env_var',
        'vercel',
        'Create or update an environment variable',
        'POST',
        [
          CommonParameters.projectId,
          createParameter('key', 'string', 'Environment variable key', { required: true }),
          createParameter('value', 'string', 'Environment variable value', { required: true }),
          createParameter('target', 'array', 'Deployment targets', {
            required: false,
            default: ['production', 'preview', 'development'],
          }),
          createParameter('type', 'string', 'Variable type', {
            required: false,
            enum: ['plain', 'secret', 'encrypted'],
            default: 'encrypted',
          }),
        ],
        { requiredScopes: ['env:write'] }
      ),
      async (params, context) => {
        const body = {
          key: params.key,
          value: params.value,
          target: params.target || ['production', 'preview', 'development'],
          type: params.type || 'encrypted',
        };

        const data = await this.makeRequest(
          context.connectionId,
          'POST',
          `${VERCEL_API_BASE}/v10/projects/${params.projectId}/env`,
          { body, timeout: 20000 } // 20 second timeout
        );

        return data;
      }
    );

    // Delete environment variable
    this.registerTool(
      createToolSchema(
        'vercel_delete_env_var',
        'vercel',
        'Delete an environment variable',
        'DELETE',
        [
          CommonParameters.projectId,
          createParameter('envId', 'string', 'Environment variable ID', { required: true }),
        ],
        { 
          requiredScopes: ['env:write'],
          dangerous: true,
        }
      ),
      async (params, context) => {
        await this.makeRequest(
          context.connectionId,
          'DELETE',
          `${VERCEL_API_BASE}/v9/projects/${params.projectId}/env/${params.envId}`,
          { timeout: 500000 } // 5 min timeout for deployment cancellation
        );

        return {
          success: true,
          message: `Environment variable deleted successfully`,
        };
      }
    );
  }
}

// Initialize and register Vercel tools
export function initializeVercelMCP(): void {
  const vercelMCP = new VercelMCP();
  vercelMCP.registerTools();
}
