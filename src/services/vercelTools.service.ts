import { DynamicTool } from '@langchain/core/tools';
import { VercelService } from './vercel.service';
import { loggingService } from './logging.service';

/**
 * Vercel Tools for LangChain Agent
 * Provides tools for the AI agent to interact with Vercel
 * The AI will intelligently decide which tools to use based on user requests
 */

export class VercelToolsService {
  /**
   * Parse input that might be a JSON object or plain string
   * The AI sometimes passes {"project":"name"} instead of just "name"
   */
  private static parseProjectInput(input: string): string {
    if (!input) return '';
    
    const trimmed = input.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        return (parsed.project || parsed.projectName || parsed.name || trimmed).trim();
      } catch {
        // Not valid JSON, use as-is
      }
    }
    return trimmed;
  }

  /**
   * Create Vercel tools for the agent
   */
  static createVercelTools(connectionId: string): DynamicTool[] {
    return [
      this.createListProjectsTool(connectionId),
      this.createGetProjectTool(connectionId),
      this.createListDeploymentsTool(connectionId),
      this.createGetDeploymentTool(connectionId),
      this.createListDomainsTool(connectionId),
      this.createListEnvVarsTool(connectionId),
      this.createTriggerDeploymentTool(connectionId),
      this.createRollbackDeploymentTool(connectionId),
    ];
  }

  /**
   * List all Vercel projects
   */
  private static createListProjectsTool(connectionId: string): DynamicTool {
    return new DynamicTool({
      name: 'vercel_list_projects',
      description: 'List all Vercel projects for the connected account. Returns a JSON object with: {success: boolean, count: number, projects: array}. The count field shows the total number of projects (0 means no projects). The projects array contains project details when count > 0. Use this when user asks to see their Vercel projects.',
      func: async (input: string) => {
        try {
          loggingService.info('AI calling Vercel tool: list_projects', { 
            connectionId,
            input: input || 'no filter'
          });

          // Always refresh to get latest data from Vercel API
          const projects = await VercelService.getProjects(connectionId, true);
          
          loggingService.info('Projects received in vercel tool', {
            connectionId,
            projectsReceived: projects.length,
            projectNames: projects.map((p: any) => p.name),
            firstProject: projects[0],
            projectsType: typeof projects,
            isArray: Array.isArray(projects)
          });
          
          // Parse input if it's a JSON string
          let parsedInput: any = {};
          try {
            if (input && input.trim() && input.trim() !== '{}') {
              parsedInput = JSON.parse(input);
            }
          } catch (e) {
            // If parsing fails, treat as a search term only if it's not empty JSON
            if (input !== '{}') {
              parsedInput = { search: input };
            }
          }
          
          // Filter projects if search term is provided
          let filteredProjects = projects;
          const searchTerm = parsedInput.search || '';
          
          // Only filter if we have a real search term (not empty JSON)
          if (searchTerm && searchTerm.trim() && searchTerm !== '{}') {
            const search = searchTerm.toLowerCase();
            filteredProjects = projects.filter((p: any) => 
              p.name.toLowerCase().includes(search) || 
              p.id.toLowerCase().includes(search)
            );
          }
          
          loggingService.info('After filtering projects', {
            connectionId,
            originalCount: projects.length,
            filteredCount: filteredProjects.length,
            hasSearchTerm: !!searchTerm,
            searchTerm,
            input,
            parsedInput
          });

          const result = {
            success: true,
            count: filteredProjects.length,
            projects: filteredProjects.map((p: any) => ({
              id: p.id,
              name: p.name,
              framework: p.framework,
              updatedAt: p.updatedAt,
            })),
          };
          
          loggingService.info('Vercel tool returning projects', {
            connectionId,
            count: result.count,
            projectNames: result.projects.map(p => p.name)
          });

          return JSON.stringify(result);
        } catch (error: any) {
          loggingService.error('Vercel tool error: list_projects', {
            error: error.message,
            connectionId,
            input,
          });
          return JSON.stringify({
            success: false,
            error: error.message,
          });
        }
      },
    });
  }

  /**
   * Get details about a specific project
   */
  private static createGetProjectTool(connectionId: string): DynamicTool {
    return new DynamicTool({
      name: 'vercel_get_project',
      description: 'Get detailed information about a specific Vercel project. Input should be the project name or ID. Returns a JSON object with project details including id, name, framework, and latest deployments. Use this when user asks for details about a specific Vercel project.',
      func: async (input: string) => {
        try {
          const projectName = this.parseProjectInput(input);
          
          loggingService.info('AI calling Vercel tool: get_project', {
            connectionId,
            projectName,
          });

          const project = await VercelService.getProject(connectionId, projectName);

          const result = {
            success: true,
            project: {
              id: project.id,
              name: project.name,
              framework: project.framework,
              updatedAt: project.updatedAt,
              targets: project.targets,
              latestDeployments: project.latestDeployments,
            },
          };
          
          loggingService.info('Vercel tool returning project details', {
            connectionId,
            projectName: project.name,
            projectId: project.id
          });

          return JSON.stringify(result);
        } catch (error: any) {
          loggingService.error('Vercel tool error: get_project', {
            error: error.message,
            connectionId,
            input,
          });
          return JSON.stringify({
            success: false,
            error: error.message,
          });
        }
      },
    });
  }

  /**
   * List deployments for a project
   */
  private static createListDeploymentsTool(connectionId: string): DynamicTool {
    return new DynamicTool({
      name: 'vercel_list_deployments',
      description: 'List all deployments for a specific Vercel project. Input REQUIRED: project name or ID. Returns a JSON object with count of deployments and array of deployment details. Use this when user asks about deployments, deployment history, or deployment status for a Vercel project.',
      func: async (input: string) => {
        try {
          const projectName = this.parseProjectInput(input);

          if (!projectName) {
            return JSON.stringify({
              success: false,
              error: 'Project name or ID is required. Please provide the project name or ID.',
            });
          }

          loggingService.info('AI calling Vercel tool: list_deployments', {
            connectionId,
            projectName,
          });

          const project = await VercelService.getProject(connectionId, projectName);
          const deployments = await VercelService.getDeployments(connectionId, project.id, 20);

          const result = {
            success: true,
            count: deployments.length,
            projectName: project.name,
            deployments: deployments.map((d: any) => ({
              uid: d.uid,
              state: d.state,
              url: d.url,
              createdAt: d.createdAt,
            })),
          };
          
          loggingService.info('Vercel tool returning deployments', {
            connectionId,
            projectName: project.name,
            deploymentCount: deployments.length,
            latestDeployment: deployments[0]?.uid
          });

          return JSON.stringify(result);
        } catch (error: any) {
          loggingService.error('Vercel tool error: list_deployments', {
            error: error.message,
            connectionId,
            input,
          });
          return JSON.stringify({
            success: false,
            error: error.message,
          });
        }
      },
    });
  }

  /**
   * Get details about a specific deployment
   */
  private static createGetDeploymentTool(connectionId: string): DynamicTool {
    return new DynamicTool({
      name: 'vercel_get_deployment',
      description: 'Get detailed information about a specific deployment. Input REQUIRED: deployment ID (uid). Returns a JSON object with deployment details including state, URL, and creation time. Use this when user asks for details about a specific deployment.',
      func: async (deploymentId: string) => {
        try {
          if (!deploymentId || !deploymentId.trim()) {
            return JSON.stringify({
              success: false,
              error: 'Deployment ID is required. Please provide the deployment ID.',
            });
          }

          loggingService.info('AI calling Vercel tool: get_deployment', {
            connectionId,
            deploymentId,
          });

          const deployment = await VercelService.getDeployment(connectionId, deploymentId);

          const result = {
            success: true,
            deployment: {
              uid: deployment.uid,
              state: deployment.state,
              url: deployment.url,
              createdAt: deployment.createdAt,
            },
          };
          
          loggingService.info('Vercel tool returning deployment details', {
            connectionId,
            deploymentId: deployment.uid,
            state: deployment.state,
            url: deployment.url
          });

          return JSON.stringify(result);
        } catch (error: any) {
          loggingService.error('Vercel tool error: get_deployment', {
            error: error.message,
            connectionId,
            deploymentId,
          });
          return JSON.stringify({
            success: false,
            error: error.message,
          });
        }
      },
    });
  }

  /**
   * List domains for a project
   */
  private static createListDomainsTool(connectionId: string): DynamicTool {
    return new DynamicTool({
      name: 'vercel_list_domains',
      description: 'List all domains for a specific Vercel project. Input REQUIRED: project name or ID. Returns a JSON object with count of domains and array of domain details. Use this when user asks about domains, custom domains, or domain configuration for a Vercel project.',
      func: async (input: string) => {
        try {
          const projectName = this.parseProjectInput(input);
          
          if (!projectName) {
            return JSON.stringify({
              success: false,
              error: 'Project name or ID is required. Please provide the project name or ID.',
            });
          }

          loggingService.info('AI calling Vercel tool: list_domains', {
            connectionId,
            projectName,
          });

          const project = await VercelService.getProject(connectionId, projectName);
          const domains = await VercelService.getDomains(connectionId, project.id);

          const result = {
            success: true,
            count: domains.length,
            projectName: project.name,
            domains: domains.map((d: any) => ({
              name: d.name,
              verified: d.verified,
              createdAt: d.createdAt,
            })),
          };
          
          loggingService.info('Vercel tool returning domains', {
            connectionId,
            projectName: project.name,
            domainCount: domains.length,
            domainNames: domains.map((d: any) => d.name)
          });

          return JSON.stringify(result);
        } catch (error: any) {
          loggingService.error('Vercel tool error: list_domains', {
            error: error.message,
            connectionId,
            input,
          });
          return JSON.stringify({
            success: false,
            error: error.message,
          });
        }
      },
    });
  }

  /**
   * List environment variables for a project
   */
  private static createListEnvVarsTool(connectionId: string): DynamicTool {
    return new DynamicTool({
      name: 'vercel_list_env_vars',
      description: 'List all environment variables for a specific Vercel project. Input REQUIRED: project name or ID. Returns a JSON object with count of env vars and array of env var details (keys only, not values). Use this when user asks about environment variables or project configuration.',
      func: async (input: string) => {
        try {
          const projectName = this.parseProjectInput(input);
          
          if (!projectName) {
            return JSON.stringify({
              success: false,
              error: 'Project name or ID is required. Please provide the project name or ID.',
            });
          }

          loggingService.info('AI calling Vercel tool: list_env_vars', {
            connectionId,
            projectName,
          });

          const project = await VercelService.getProject(connectionId, projectName);
          const envVars = await VercelService.getEnvVars(connectionId, project.id);

          const result = {
            success: true,
            count: envVars.length,
            projectName: project.name,
            envVars: envVars.map((e: any) => ({
              key: e.key,
              target: e.target,
              createdAt: e.createdAt,
            })),
          };
          
          loggingService.info('Vercel tool returning env vars', {
            connectionId,
            projectName: project.name,
            envVarCount: envVars.length,
            envVarKeys: envVars.map((e: any) => e.key)
          });

          return JSON.stringify(result);
        } catch (error: any) {
          loggingService.error('Vercel tool error: list_env_vars', {
            error: error.message,
            connectionId,
            input,
          });
          return JSON.stringify({
            success: false,
            error: error.message,
          });
        }
      },
    });
  }

  /**
   * Trigger a new deployment
   */
  private static createTriggerDeploymentTool(connectionId: string): DynamicTool {
    return new DynamicTool({
      name: 'vercel_trigger_deployment',
      description: 'Trigger a new deployment for a Vercel project. Input REQUIRED: project name or ID. Returns a JSON object with deployment details. Use this when user asks to deploy, trigger deployment, or redeploy a Vercel project.',
      func: async (input: string) => {
        try {
          const projectName = this.parseProjectInput(input);
          
          if (!projectName) {
            return JSON.stringify({
              success: false,
              error: 'Project name or ID is required. Please provide the project name or ID.',
            });
          }

          loggingService.info('AI calling Vercel tool: trigger_deployment', {
            connectionId,
            projectName,
          });

          const deployment = await VercelService.triggerDeployment(connectionId, projectName);

          const result = {
            success: true,
            message: `Deployment triggered successfully for project: ${projectName}`,
            deployment: {
              uid: deployment.uid,
              state: deployment.state,
              url: deployment.url,
              createdAt: deployment.createdAt,
            },
          };
          
          loggingService.info('Vercel tool triggered deployment', {
            connectionId,
            projectName,
            deploymentId: deployment.uid,
            state: deployment.state,
            url: deployment.url
          });

          return JSON.stringify(result);
        } catch (error: any) {
          loggingService.error('Vercel tool error: trigger_deployment', {
            error: error.message,
            connectionId,
            input,
          });
          return JSON.stringify({
            success: false,
            error: error.message,
          });
        }
      },
    });
  }

  /**
   * Rollback a deployment
   */
  private static createRollbackDeploymentTool(connectionId: string): DynamicTool {
    return new DynamicTool({
      name: 'vercel_rollback_deployment',
      description: 'Rollback a deployment to a previous version. Input REQUIRED: format "projectName:deploymentId" (e.g., "my-app:dpl_abc123"). Returns a JSON object with new deployment details. Use this when user asks to rollback, revert, or go back to a previous deployment.',
      func: async (input: string) => {
        try {
          const [projectName, deploymentId] = input.split(':');

          loggingService.info('AI calling Vercel tool: rollback_deployment', {
            connectionId,
            projectName,
            deploymentId,
          });

          const rollbackResult = await VercelService.rollbackDeployment(
            connectionId,
            projectName,
            deploymentId
          );

          const result = {
            success: true,
            message: 'Deployment rolled back successfully',
            deployment: {
              uid: rollbackResult.uid,
              state: rollbackResult.state,
              url: rollbackResult.url,
            },
          };
          
          loggingService.info('Vercel tool rolled back deployment', {
            connectionId,
            projectName,
            deploymentId,
            newDeploymentId: rollbackResult.uid,
            state: rollbackResult.state
          });

          return JSON.stringify(result);
        } catch (error: any) {
          loggingService.error('Vercel tool error: rollback_deployment', {
            error: error.message,
            connectionId,
            input,
          });
          return JSON.stringify({
            success: false,
            error: error.message,
          });
        }
      },
    });
  }
}

export default VercelToolsService;
