import { Injectable, Inject, Logger } from '@nestjs/common';
import { BaseAgentTool } from './base-agent.tool';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

interface Project {
  _id: string;
  name: string;
  userId: string;
  budget?: {
    amount: number;
    currency: string;
  };
  settings?: any;
  isActive: boolean;
  createdAt: Date;
}

/**
 * Project Manager Tool Service
 * Manages projects: create, update, get, list, delete, configure
 * Ported from Express ProjectManagerTool with NestJS patterns
 */
@Injectable()
export class ProjectManagerToolService extends BaseAgentTool {
  constructor(
    @InjectModel('Project') // Assuming Project schema exists
    private readonly projectModel: Model<Project>,
  ) {
    super(
      'project_manager',
      `Manage projects, create new projects, and handle project-related operations:
- Create new AI projects with optimal settings
- Update project configurations and budgets
- Get detailed project information
- List all projects for a user
- Delete projects (with confirmation)
- Configure project settings for cost optimization

Input should be a JSON string with:
{
  "operation": "create|update|get|list|delete|configure",
  "projectId": "string", // Required for update/get/delete/configure
  "projectData": {...}, // Required for create/update
  "userId": "string" // Required for all operations
}`,
    );
  }

  protected async executeLogic(input: any): Promise<any> {
    try {
      const { operation, projectId, projectData, userId } = input;

      if (!userId) {
        return this.createErrorResponse(
          'project_manager',
          'userId is required',
        );
      }

      switch (operation) {
        case 'create':
          return await this.createProject(userId, projectData);

        case 'update':
          return await this.updateProject(userId, projectId, projectData);

        case 'get':
          return await this.getProject(userId, projectId);

        case 'list':
          return await this.listProjects(userId);

        case 'delete':
          return await this.deleteProject(userId, projectId);

        case 'configure':
          return await this.configureProject(userId, projectId, projectData);

        default:
          return this.createErrorResponse(
            'project_manager',
            `Unsupported operation: ${operation}`,
          );
      }
    } catch (error: any) {
      this.logger.error('Project manager operation failed', {
        error: error.message,
        input,
      });
      return this.createErrorResponse('project_manager', error.message);
    }
  }

  private async createProject(userId: string, projectData: any): Promise<any> {
    const project = new this.projectModel({
      ...projectData,
      userId,
      isActive: true,
      createdAt: new Date(),
    });

    const saved = await project.save();

    return this.createSuccessResponse('project_manager', {
      operation: 'create',
      project: {
        id: saved._id,
        name: saved.name,
        budget: saved.budget,
        isActive: saved.isActive,
      },
    });
  }

  private async updateProject(
    userId: string,
    projectId: string,
    projectData: any,
  ): Promise<any> {
    const project = await this.projectModel.findOneAndUpdate(
      { _id: projectId, userId },
      projectData,
      { new: true },
    );

    if (!project) {
      return this.createErrorResponse('project_manager', 'Project not found');
    }

    return this.createSuccessResponse('project_manager', {
      operation: 'update',
      project: {
        id: project._id,
        name: project.name,
        budget: project.budget,
        isActive: project.isActive,
      },
    });
  }

  private async getProject(userId: string, projectId: string): Promise<any> {
    const project = await this.projectModel.findOne({ _id: projectId, userId });

    if (!project) {
      return this.createErrorResponse('project_manager', 'Project not found');
    }

    return this.createSuccessResponse('project_manager', {
      operation: 'get',
      project: {
        id: project._id,
        name: project.name,
        budget: project.budget,
        settings: project.settings,
        isActive: project.isActive,
        createdAt: project.createdAt,
      },
    });
  }

  private async listProjects(userId: string): Promise<any> {
    const projects = await this.projectModel
      .find({ userId, isActive: true })
      .select('name budget createdAt')
      .sort({ createdAt: -1 });

    return this.createSuccessResponse('project_manager', {
      operation: 'list',
      projects: projects.map((p) => ({
        id: p._id,
        name: p.name,
        budget: p.budget,
        createdAt: p.createdAt,
      })),
      count: projects.length,
    });
  }

  private async deleteProject(userId: string, projectId: string): Promise<any> {
    const project = await this.projectModel.findOneAndUpdate(
      { _id: projectId, userId },
      { isActive: false },
      { new: true },
    );

    if (!project) {
      return this.createErrorResponse('project_manager', 'Project not found');
    }

    return this.createSuccessResponse('project_manager', {
      operation: 'delete',
      project: {
        id: project._id,
        name: project.name,
        deleted: true,
      },
    });
  }

  private async configureProject(
    userId: string,
    projectId: string,
    config: any,
  ): Promise<any> {
    const project = await this.projectModel.findOneAndUpdate(
      { _id: projectId, userId },
      { settings: config },
      { new: true },
    );

    if (!project) {
      return this.createErrorResponse('project_manager', 'Project not found');
    }

    return this.createSuccessResponse('project_manager', {
      operation: 'configure',
      project: {
        id: project._id,
        name: project.name,
        settings: project.settings,
      },
    });
  }
}
