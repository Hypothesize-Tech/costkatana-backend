import { Injectable, Inject, Logger } from '@nestjs/common';
import { DynamicTool } from '@langchain/core/tools';
import { VercelService } from '../../vercel/vercel.service';

/**
 * Vercel Tools Service
 * Creates dynamic Vercel tools for the AI agent based on user connections
 * Ported from Express VercelToolsService with NestJS patterns
 */
@Injectable()
export class VercelToolsService {
  private readonly logger = new Logger(VercelToolsService.name);

  constructor(
    @Inject(VercelService)
    private readonly vercelService: VercelService,
  ) {}

  /**
   * Parse input that might be a JSON object or plain string
   */
  private parseProjectInput(input: string): string {
    if (!input) return '';

    const trimmed = input.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        return (
          parsed.project ||
          parsed.projectName ||
          parsed.name ||
          trimmed
        ).trim();
      } catch {
        // Not valid JSON, use as-is
      }
    }
    return trimmed;
  }

  /**
   * Create Vercel tools for the agent based on connection
   */
  createVercelTools(connectionId: string): DynamicTool[] {
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
  private createListProjectsTool(connectionId: string): DynamicTool {
    return new DynamicTool({
      name: 'vercel_list_projects',
      description:
        'List all Vercel projects for the connected account. Returns JSON with count and projects array. Use when user asks to see their Vercel projects.',
      func: async (input: string) => {
        try {
          this.logger.log(
            `Listing Vercel projects for connection ${connectionId}`,
          );

          const projects = await this.vercelService.getProjects(
            connectionId,
            true,
          );

          // Parse input for filtering
          let searchTerm = '';
          try {
            if (input && input.trim() && input.trim() !== '{}') {
              const parsed = JSON.parse(input);
              searchTerm = parsed.search || '';
            }
          } catch {
            if (input !== '{}') {
              searchTerm = input;
            }
          }

          // Filter projects if search term provided
          let filteredProjects = projects;
          if (searchTerm && searchTerm.trim()) {
            const search = searchTerm.toLowerCase();
            filteredProjects = projects.filter(
              (p: any) =>
                p.name.toLowerCase().includes(search) ||
                p.id.toLowerCase().includes(search),
            );
          }

          return JSON.stringify({
            success: true,
            count: filteredProjects.length,
            projects: filteredProjects,
            message: `Found ${filteredProjects.length} Vercel projects`,
          });
        } catch (error: any) {
          this.logger.error(`Failed to list Vercel projects: ${error.message}`);
          return JSON.stringify({
            success: false,
            error: error.message,
            count: 0,
            projects: [],
          });
        }
      },
    });
  }

  /**
   * Get detailed project information
   */
  private createGetProjectTool(connectionId: string): DynamicTool {
    return new DynamicTool({
      name: 'vercel_get_project',
      description:
        'Get detailed information about a specific Vercel project. Input should be project name or ID.',
      func: async (input: string) => {
        try {
          const projectName = this.parseProjectInput(input);
          this.logger.log(`Getting Vercel project details: ${projectName}`);

          const project = await this.vercelService.getProject(
            connectionId,
            projectName,
          );

          return JSON.stringify({
            success: true,
            project,
            message: `Retrieved details for project ${projectName}`,
          });
        } catch (error: any) {
          this.logger.error(`Failed to get Vercel project: ${error.message}`);
          return JSON.stringify({
            success: false,
            error: error.message,
            project: null,
          });
        }
      },
    });
  }

  /**
   * List deployments for a project
   */
  private createListDeploymentsTool(connectionId: string): DynamicTool {
    return new DynamicTool({
      name: 'vercel_list_deployments',
      description:
        'List all deployments for a specific Vercel project. Input should be project name or ID.',
      func: async (input: string) => {
        try {
          const projectName = this.parseProjectInput(input);
          this.logger.log(`Listing deployments for project: ${projectName}`);

          const deployments = await this.vercelService.getDeployments(
            connectionId,
            projectName,
          );

          return JSON.stringify({
            success: true,
            count: deployments.length,
            deployments,
            message: `Found ${deployments.length} deployments for project ${projectName}`,
          });
        } catch (error: any) {
          this.logger.error(`Failed to list deployments: ${error.message}`);
          return JSON.stringify({
            success: false,
            error: error.message,
            count: 0,
            deployments: [],
          });
        }
      },
    });
  }

  /**
   * Get deployment details
   */
  private createGetDeploymentTool(connectionId: string): DynamicTool {
    return new DynamicTool({
      name: 'vercel_get_deployment',
      description:
        'Get detailed information about a specific deployment. Input should be deployment ID.',
      func: async (input: string) => {
        try {
          const deploymentId = input.trim();
          this.logger.log(`Getting deployment details: ${deploymentId}`);

          const deployment = await this.vercelService.getDeployment(
            connectionId,
            deploymentId,
          );

          return JSON.stringify({
            success: true,
            deployment,
            message: `Retrieved details for deployment ${deploymentId}`,
          });
        } catch (error: any) {
          this.logger.error(`Failed to get deployment: ${error.message}`);
          return JSON.stringify({
            success: false,
            error: error.message,
            deployment: null,
          });
        }
      },
    });
  }

  /**
   * List domains for a project
   */
  private createListDomainsTool(connectionId: string): DynamicTool {
    return new DynamicTool({
      name: 'vercel_list_domains',
      description:
        'List all domains configured for a Vercel project. Input should be project name or ID.',
      func: async (input: string) => {
        try {
          const projectName = this.parseProjectInput(input);
          this.logger.log(`Listing domains for project: ${projectName}`);

          const domains = await this.vercelService.getDomains(
            connectionId,
            projectName,
          );

          return JSON.stringify({
            success: true,
            count: domains.length,
            domains,
            message: `Found ${domains.length} domains for project ${projectName}`,
          });
        } catch (error: any) {
          this.logger.error(`Failed to list domains: ${error.message}`);
          return JSON.stringify({
            success: false,
            error: error.message,
            count: 0,
            domains: [],
          });
        }
      },
    });
  }

  /**
   * List environment variables
   */
  private createListEnvVarsTool(connectionId: string): DynamicTool {
    return new DynamicTool({
      name: 'vercel_list_env_vars',
      description:
        'List all environment variables for a Vercel project. Input should be project name or ID.',
      func: async (input: string) => {
        try {
          const projectName = this.parseProjectInput(input);
          this.logger.log(`Listing env vars for project: ${projectName}`);

          const envVars = await this.vercelService.getEnvVars(
            connectionId,
            projectName,
          );

          return JSON.stringify({
            success: true,
            count: envVars.length,
            envVars: envVars.map(
              (ev: { key: string; type: string; target: string[] }) => ({
                key: ev.key,
                type: ev.type,
                target: ev.target,
              }),
            ),
            message: `Found ${envVars.length} environment variables for project ${projectName}`,
          });
        } catch (error: any) {
          this.logger.error(`Failed to list env vars: ${error.message}`);
          return JSON.stringify({
            success: false,
            error: error.message,
            count: 0,
            envVars: [],
          });
        }
      },
    });
  }

  /**
   * Trigger deployment
   */
  private createTriggerDeploymentTool(connectionId: string): DynamicTool {
    return new DynamicTool({
      name: 'vercel_trigger_deployment',
      description:
        'Trigger a new deployment for a Vercel project. Input should be project name or ID.',
      func: async (input: string) => {
        try {
          const projectName = this.parseProjectInput(input);
          this.logger.log(`Triggering deployment for project: ${projectName}`);

          const deployment = await this.vercelService.triggerDeployment(
            connectionId,
            projectName,
            {},
          );

          return JSON.stringify({
            success: true,
            deployment,
            message: `Successfully triggered deployment for project ${projectName}`,
          });
        } catch (error: any) {
          this.logger.error(`Failed to trigger deployment: ${error.message}`);
          return JSON.stringify({
            success: false,
            error: error.message,
            deployment: null,
          });
        }
      },
    });
  }

  /**
   * Rollback deployment
   */
  private createRollbackDeploymentTool(connectionId: string): DynamicTool {
    return new DynamicTool({
      name: 'vercel_rollback_deployment',
      description:
        'Rollback a Vercel project to a previous deployment. Input should be JSON with project and deploymentId.',
      func: async (input: string) => {
        try {
          const params = JSON.parse(input);
          const { project, deploymentId } = params;

          this.logger.log(
            `Rolling back project ${project} to deployment ${deploymentId}`,
          );

          const result = await this.vercelService.rollbackDeployment(
            connectionId,
            project,
            deploymentId,
          );

          return JSON.stringify({
            success: true,
            result,
            message: `Successfully rolled back project ${project} to deployment ${deploymentId}`,
          });
        } catch (error: any) {
          this.logger.error(`Failed to rollback deployment: ${error.message}`);
          return JSON.stringify({
            success: false,
            error: error.message,
            result: null,
          });
        }
      },
    });
  }
}
