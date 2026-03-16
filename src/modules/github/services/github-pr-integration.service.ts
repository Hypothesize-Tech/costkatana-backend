import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { GithubOAuthApiService } from './github-oauth-api.service';
import {
  GithubAnalysisService,
  AnalysisResult,
} from './github-analysis.service';
import {
  GithubCodeGeneratorService,
  CodeGenerationRequest,
  GeneratedCode,
  IFeatureConfig,
} from './github-code-generator.service';
import { GithubCacheInvalidationService } from './github-cache-invalidation.service';
import {
  GitHubIntegration,
  GitHubIntegrationDocument,
  ICommit,
} from '../../../schemas/integration/github-integration.schema';
import {
  GitHubConnection,
  GitHubConnectionDocument,
} from '../../../schemas/integration/github-connection.schema';

export interface StartIntegrationRequest {
  userId: string;
  connectionId: string;
  repositoryId: number;
  repositoryName: string;
  repositoryFullName: string;
  branchName: string;
  integrationType: 'npm' | 'cli' | 'python' | 'http-headers';
  selectedFeatures: IFeatureConfig[];
  conversationId?: string;
}

export interface UpdateIntegrationRequest {
  selectedFeatures?: IFeatureConfig[];
  conversationId?: string;
}

export interface IntegrationStatus {
  id: string;
  status: string;
  repositoryFullName: string;
  branchName: string;
  integrationType: string;
  selectedFeatures: IFeatureConfig[];
  prNumber?: number;
  prUrl?: string;
  prTitle?: string;
  errorMessage?: string;
  lastActivityAt?: Date;
  progress?: {
    currentStep: string;
    steps: string[];
    completedSteps: number;
  };
}

@Injectable()
export class GithubPRIntegrationService {
  private readonly logger = new Logger(GithubPRIntegrationService.name);

  // Workflow steps
  private readonly WORKFLOW_STEPS = [
    'initializing',
    'analyzing',
    'generating',
    'draft',
    'open',
    'updating',
    'merged',
    'closed',
    'failed',
    'permission_error',
  ];

  constructor(
    @InjectModel(GitHubIntegration.name)
    private readonly integrationModel: Model<GitHubIntegrationDocument>,
    @InjectModel(GitHubConnection.name)
    private readonly connectionModel: Model<GitHubConnectionDocument>,
    private readonly configService: ConfigService,
    private readonly githubOAuthApiService: GithubOAuthApiService,
    private readonly githubAnalysisService: GithubAnalysisService,
    private readonly githubCodeGeneratorService: GithubCodeGeneratorService,
    private readonly githubCacheInvalidationService: GithubCacheInvalidationService,
  ) {}

  /**
   * Start a new GitHub integration process
   */
  async startIntegration(
    request: StartIntegrationRequest,
  ): Promise<GitHubIntegrationDocument> {
    try {
      this.logger.log('Starting GitHub integration', {
        userId: request.userId,
        repository: request.repositoryFullName,
        integrationType: request.integrationType,
      });

      // Create integration record
      const integration = new this.integrationModel({
        userId: request.userId,
        connectionId: request.connectionId,
        repositoryId: request.repositoryId,
        repositoryName: request.repositoryName,
        repositoryFullName: request.repositoryFullName,
        branchName: request.branchName,
        integrationType: request.integrationType,
        selectedFeatures: request.selectedFeatures,
        conversationId: request.conversationId,
        status: 'initializing',
        lastActivityAt: new Date(),
      });

      await integration.save();

      // Start async workflow
      this.processIntegration(integration._id.toString()).catch((error) => {
        this.logger.error('Integration workflow failed', {
          integrationId: integration._id.toString(),
          error: error.message,
          stack: error.stack,
        });
      });

      return integration;
    } catch (error: any) {
      this.logger.error('Failed to start integration', {
        userId: request.userId,
        repository: request.repositoryFullName,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Process integration workflow asynchronously
   */
  private async processIntegration(integrationId: string): Promise<void> {
    const integration = await this.integrationModel.findById(integrationId);
    if (!integration) {
      throw new Error(`Integration ${integrationId} not found`);
    }

    try {
      // Step 1: Update status to analyzing
      await this.updateIntegrationStatus(integrationId, 'analyzing');

      // Step 2: Analyze repository
      const connection = await this.findConnectionById(
        integration.connectionId.toString(),
      );
      const analysisResults =
        await this.githubAnalysisService.analyzeRepository(
          connection,
          integration.repositoryFullName,
          integration.branchName,
        );

      // Step 3: Store analysis results
      await this.integrationModel.findByIdAndUpdate(integrationId, {
        analysisResults,
        lastActivityAt: new Date(),
      });

      // Step 4: Update status to generating
      await this.updateIntegrationStatus(integrationId, 'generating');

      // Step 5: Generate code
      const codeGenerationRequest: CodeGenerationRequest = {
        repositoryFullName: integration.repositoryFullName,
        integrationType: integration.integrationType,
        selectedFeatures: integration.selectedFeatures,
        analysisResults,
      };

      const generatedCode =
        await this.githubCodeGeneratorService.generateIntegrationCode(
          codeGenerationRequest,
        );

      // Step 6: Create branch
      const branchName = `cost-katana-integration-${Date.now()}`;
      await this.githubOAuthApiService.createBranch(connection, {
        owner: integration.repositoryFullName.split('/')[0],
        repo: integration.repositoryName,
        branchName,
        fromBranch: integration.branchName,
      });

      // Step 7: Create files and commits
      const commits: ICommit[] = [];
      for (const file of generatedCode.files) {
        const result = await this.githubOAuthApiService.createOrUpdateFile(
          connection,
          {
            owner: integration.repositoryFullName.split('/')[0],
            repo: integration.repositoryName,
            branch: branchName,
            path: file.path,
            content: file.content,
            message: `Add ${file.description}`,
          },
        );

        commits.push({
          sha: result.sha,
          message: `Add ${file.description}`,
          timestamp: new Date(),
        });
      }

      // Step 8: Update package.json if provided
      if (generatedCode.packageJson) {
        try {
          const packageJsonContent =
            await this.githubOAuthApiService.getFileContent(
              connection,
              integration.repositoryFullName.split('/')[0],
              integration.repositoryName,
              'package.json',
              branchName,
            );

          const existingPackageJson = JSON.parse(packageJsonContent);
          const updatedPackageJson = this.mergePackageJson(
            existingPackageJson,
            generatedCode.packageJson,
          );

          await this.githubOAuthApiService.createOrUpdateFile(connection, {
            owner: integration.repositoryFullName.split('/')[0],
            repo: integration.repositoryName,
            branch: branchName,
            path: 'package.json',
            content: JSON.stringify(updatedPackageJson, null, 2),
            message: 'Update package.json with Cost Katana dependencies',
          });

          commits.push({
            sha: 'updated-package-json',
            message: 'Update package.json with Cost Katana dependencies',
            timestamp: new Date(),
          });
        } catch (error) {
          // package.json might not exist, continue
          this.logger.warn('Could not update package.json', {
            integrationId,
            error: error.message,
          });
        }
      }

      // Step 9: Create pull request
      const prTitle = `🤖 Integrate Cost Katana AI Cost Optimization`;
      const prBody = this.generatePRDescription(
        generatedCode,
        analysisResults,
        integration.selectedFeatures,
      );

      const pr = await this.githubOAuthApiService.createPullRequest(
        connection,
        {
          owner: integration.repositoryFullName.split('/')[0],
          repo: integration.repositoryName,
          title: prTitle,
          body: prBody,
          head: branchName,
          base: integration.branchName,
          draft: true,
        },
      );

      // Step 10: Update integration record
      await this.integrationModel.findByIdAndUpdate(integrationId, {
        status: 'draft',
        branchName,
        commits,
        prNumber: pr.number,
        prUrl: pr.html_url,
        prTitle,
        prDescription: prBody,
        lastActivityAt: new Date(),
      });

      this.logger.log('Integration workflow completed successfully', {
        integrationId,
        prNumber: pr.number,
        prUrl: pr.html_url,
      });
    } catch (error: any) {
      this.logger.error('Integration workflow failed', {
        integrationId,
        error: error.message,
        stack: error.stack,
      });

      // Update integration with error status
      await this.integrationModel.findByIdAndUpdate(integrationId, {
        status: error.message.includes('permission')
          ? 'permission_error'
          : 'failed',
        errorMessage: error.message,
        errorStack: error.stack,
        lastActivityAt: new Date(),
      });

      throw error;
    }
  }

  /**
   * Update integration from chat interaction
   */
  async updateIntegrationFromChat(
    integrationId: string,
    updates: UpdateIntegrationRequest,
  ): Promise<GitHubIntegrationDocument> {
    try {
      const integration = await this.integrationModel.findById(integrationId);
      if (!integration) {
        throw new Error(`Integration ${integrationId} not found`);
      }

      this.logger.log('Updating integration from chat', {
        integrationId,
        updates,
      });

      // Update integration fields
      const updateData: any = {
        lastActivityAt: new Date(),
      };

      if (updates.selectedFeatures) {
        updateData.selectedFeatures = updates.selectedFeatures;
      }

      if (updates.conversationId) {
        updateData.conversationId = updates.conversationId;
      }

      // If features changed and PR exists, update PR
      if (updates.selectedFeatures && integration.prNumber) {
        await this.updateExistingPR(integration, updates.selectedFeatures);
        updateData.status = 'updating';
      }

      const updatedIntegration = await this.integrationModel.findByIdAndUpdate(
        integrationId,
        updateData,
        { new: true },
      );

      return updatedIntegration!;
    } catch (error: any) {
      this.logger.error('Failed to update integration from chat', {
        integrationId,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Update existing PR with new features
   */
  private async updateExistingPR(
    integration: GitHubIntegrationDocument,
    newFeatures: IFeatureConfig[],
  ): Promise<void> {
    try {
      const connection = await this.findConnectionById(
        integration.connectionId.toString(),
      );

      // Regenerate code with new features
      const codeGenerationRequest: CodeGenerationRequest = {
        repositoryFullName: integration.repositoryFullName,
        integrationType: integration.integrationType,
        selectedFeatures: newFeatures,
        analysisResults: integration.analysisResults!,
      };

      const generatedCode =
        await this.githubCodeGeneratorService.generateIntegrationCode(
          codeGenerationRequest,
        );

      // Update files on the branch
      for (const file of generatedCode.files) {
        await this.githubOAuthApiService.createOrUpdateFile(connection, {
          owner: integration.repositoryFullName.split('/')[0],
          repo: integration.repositoryName,
          branch: integration.branchName,
          path: file.path,
          content: file.content,
          message: `Update ${file.description} with new features`,
        });
      }

      // Update PR description
      const updatedBody = this.generatePRDescription(
        generatedCode,
        integration.analysisResults!,
        newFeatures,
      );

      await this.githubOAuthApiService.updatePullRequest(connection, {
        owner: integration.repositoryFullName.split('/')[0],
        repo: integration.repositoryName,
        prNumber: integration.prNumber!,
        body: updatedBody,
      });

      this.logger.log('Updated existing PR with new features', {
        integrationId: integration._id.toString(),
        prNumber: integration.prNumber,
      });
    } catch (error: any) {
      this.logger.error('Failed to update existing PR', {
        integrationId: integration._id.toString(),
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get integration status
   */
  async getIntegrationStatus(
    integrationId: string,
  ): Promise<IntegrationStatus> {
    const integration = await this.integrationModel.findById(integrationId);
    if (!integration) {
      throw new Error(`Integration ${integrationId} not found`);
    }

    const progress = this.calculateProgress(integration.status);

    return {
      id: integration._id.toString(),
      status: integration.status,
      repositoryFullName: integration.repositoryFullName,
      branchName: integration.branchName,
      integrationType: integration.integrationType,
      selectedFeatures: integration.selectedFeatures,
      prNumber: integration.prNumber,
      prUrl: integration.prUrl,
      prTitle: integration.prTitle,
      errorMessage: integration.errorMessage,
      lastActivityAt: integration.lastActivityAt,
      progress,
    };
  }

  /**
   * List user integrations
   */
  async listUserIntegrations(
    userId: string,
  ): Promise<GitHubIntegrationDocument[]> {
    return this.integrationModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Heartbeat mechanism to check for stuck integrations
   */
  async heartbeatCheck(): Promise<void> {
    try {
      const stuckThreshold = 30 * 60 * 1000; // 30 minutes
      const stuckIntegrations = await this.integrationModel.find({
        status: { $in: ['analyzing', 'generating', 'updating'] },
        lastActivityAt: { $lt: new Date(Date.now() - stuckThreshold) },
      });

      for (const integration of stuckIntegrations) {
        this.logger.warn('Found stuck integration, attempting recovery', {
          integrationId: integration._id.toString(),
          status: integration.status,
          lastActivityAt: integration.lastActivityAt,
        });

        // Attempt recovery
        await this.recoverStuckIntegration(integration._id.toString());
      }
    } catch (error: any) {
      this.logger.error('Heartbeat check failed', {
        error: error.message,
        stack: error.stack,
      });
    }
  }

  /**
   * Recover stuck integration
   */
  private async recoverStuckIntegration(integrationId: string): Promise<void> {
    try {
      const integration = await this.integrationModel.findById(integrationId);
      if (!integration) return;

      // Reset to initializing and restart workflow
      await this.integrationModel.findByIdAndUpdate(integrationId, {
        status: 'initializing',
        errorMessage: undefined,
        errorStack: undefined,
        lastActivityAt: new Date(),
      });

      // Restart workflow
      this.processIntegration(integrationId).catch((error) => {
        this.logger.error('Recovery workflow failed', {
          integrationId,
          error: error.message,
        });
      });

      this.logger.log('Stuck integration recovery initiated', {
        integrationId,
      });
    } catch (error: any) {
      this.logger.error('Failed to recover stuck integration', {
        integrationId,
        error: error.message,
      });
    }
  }

  /**
   * Update integration status
   */
  private async updateIntegrationStatus(
    integrationId: string,
    status: string,
  ): Promise<void> {
    await this.integrationModel.findByIdAndUpdate(integrationId, {
      status,
      lastActivityAt: new Date(),
    });

    this.logger.log('Updated integration status', {
      integrationId,
      status,
    });
  }

  /**
   * Find connection by ID
   *
   * Looks up a GitHub connection by its ID from the database.
   * Replace 'ConnectionModel' and return type as needed for your project.
   */
  private async findConnectionById(connectionId: string): Promise<any> {
    if (!this.connectionModel) {
      this.logger.error(
        'connectionModel is not injected into GithubPrIntegrationService',
      );
      throw new Error('Connection model is not available');
    }
    try {
      const connection = await this.connectionModel.findById(connectionId);
      if (!connection) {
        this.logger.warn(`No GitHub connection found for ID: ${connectionId}`);
        return null;
      }
      return connection;
    } catch (error: any) {
      this.logger.error('Error fetching GitHub connection', {
        connectionId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Merge package.json with new dependencies
   */
  private mergePackageJson(existing: any, updates: any): any {
    const merged = { ...existing };

    if (updates.dependencies) {
      merged.dependencies = { ...merged.dependencies, ...updates.dependencies };
    }

    if (updates.devDependencies) {
      merged.devDependencies = {
        ...merged.devDependencies,
        ...updates.devDependencies,
      };
    }

    if (updates.scripts) {
      merged.scripts = { ...merged.scripts, ...updates.scripts };
    }

    return merged;
  }

  /**
   * Generate PR description
   */
  private generatePRDescription(
    generatedCode: GeneratedCode,
    analysisResults: AnalysisResult,
    selectedFeatures: IFeatureConfig[],
  ): string {
    const features = selectedFeatures.map((f) => `- ${f.name}`).join('\n');
    const files = generatedCode.files
      .map((f) => `- ${f.path}: ${f.description}`)
      .join('\n');

    return `# 🤖 Cost Katana AI Cost Optimization Integration

This PR integrates Cost Katana's AI cost optimization platform into your project.

## What This Does

Cost Katana helps you monitor, analyze, and optimize your AI API costs across multiple providers, providing intelligent recommendations and real-time tracking.

## Features Added

${features}

## Files Added/Modified

${files}

${generatedCode.packageJson ? '## Dependencies Added\n\nNew dependencies have been added to package.json for Cost Katana integration.' : ''}

${generatedCode.requirementsTxt ? `## Python Requirements\n\n${generatedCode.requirementsTxt.join('\n')}` : ''}

## Setup Instructions

${generatedCode.setupInstructions.map((instruction) => `1. ${instruction}`).join('\n')}

## Environment Variables Required

${generatedCode.environmentVariables.map((env) => `- \`${env.name}\`: ${env.description}${env.default ? ` (default: ${env.default})` : ''}${env.required ? ' (required)' : ''}`).join('\n')}

## Repository Analysis

- **Language**: ${analysisResults.language}
- **Framework**: ${analysisResults.framework || 'Not detected'}
- **Package Manager**: ${analysisResults.packageManager || 'Not detected'}
- **Existing AI Integrations**: ${analysisResults.existingAIIntegrations.length > 0 ? analysisResults.existingAIIntegrations.join(', ') : 'None detected'}

## Next Steps

1. Review the generated code
2. Set up the required environment variables
3. Test the integration
4. Merge this PR to start optimizing your AI costs!

---

*This PR was automatically generated by Cost Katana. For questions or support, visit [docs.costkatana.com](https://docs.costkatana.com).*
`;
  }

  /**
   * Calculate progress for integration status
   */
  private calculateProgress(status: string): {
    currentStep: string;
    steps: string[];
    completedSteps: number;
  } {
    const steps = [
      'Initializing',
      'Analyzing Repository',
      'Generating Code',
      'Creating Branch',
      'Creating Files',
      'Creating PR',
    ];

    let currentStep = 'Unknown';
    let completedSteps = 0;

    if (status === 'initializing') {
      currentStep = 'Initializing';
      completedSteps = 0;
    } else if (status === 'analyzing') {
      currentStep = 'Analyzing Repository';
      completedSteps = 1;
    } else if (status === 'generating') {
      currentStep = 'Generating Code';
      completedSteps = 2;
    } else if (status === 'draft') {
      currentStep = 'Pull Request Created';
      completedSteps = 6;
    } else if (status === 'open') {
      currentStep = 'Pull Request Open';
      completedSteps = 6;
    } else if (status === 'updating') {
      currentStep = 'Updating Pull Request';
      completedSteps = 5;
    } else if (status === 'merged') {
      currentStep = 'Pull Request Merged';
      completedSteps = 7;
    } else if (status === 'closed') {
      currentStep = 'Pull Request Closed';
      completedSteps = 6;
    } else if (status === 'failed') {
      currentStep = 'Integration Failed';
      completedSteps = 0;
    } else if (status === 'permission_error') {
      currentStep = 'Permission Error';
      completedSteps = 0;
    }

    return {
      currentStep,
      steps,
      completedSteps,
    };
  }
}
