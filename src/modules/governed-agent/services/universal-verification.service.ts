import { Injectable } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { LoggerService } from '../../../common/logger/logger.service';
import {
  HealthCheckResult,
  DeploymentVerification,
  DataIntegrityCheck,
  VerificationResult,
} from '../interfaces/governed-agent.interfaces';

@Injectable()
export class UniversalVerificationService {
  private static readonly logger = new Logger(
    UniversalVerificationService.name,
  );
  constructor(private readonly logger: LoggerService) {}

  /**
   * Verify deployment URLs are accessible and healthy
   */
  static async verifyDeployments(urls: string[]): Promise<{
    success: boolean;
    overallHealth: 'healthy' | 'degraded' | 'unhealthy';
    deployments: DeploymentVerification[];
    healthChecks: HealthCheckResult[];
    recommendations: string[];
  }> {
    try {
      UniversalVerificationService.logger.log('🔍 Verifying deployments', {
        urlsCount: urls.length,
      });

      const deployments = await Promise.all(
        urls.map((url) => this.checkDeployment(url)),
      );

      const allAccessible = deployments.every((d) => d.accessible);
      const avgResponseTime =
        deployments.reduce((sum, d) => sum + d.responseTime, 0) /
        deployments.length;

      const healthChecks: HealthCheckResult[] = deployments.map((d) => ({
        name: `Deployment: ${d.url}`,
        status: d.accessible ? 'healthy' : 'unhealthy',
        responseTime: d.responseTime,
        details: { statusCode: d.statusCode, error: d.error },
        timestamp: new Date(),
      }));

      const recommendations: string[] = [];
      if (avgResponseTime > 1000) {
        recommendations.push(
          'High response times detected - consider performance optimization',
        );
      }
      if (!allAccessible) {
        recommendations.push(
          'Some deployments are not accessible - check logs and configurations',
        );
      }

      return {
        success: allAccessible,
        overallHealth: allAccessible
          ? avgResponseTime < 500
            ? 'healthy'
            : 'degraded'
          : 'unhealthy',
        deployments,
        healthChecks,
        recommendations,
      };
    } catch (error) {
      UniversalVerificationService.logger.error(
        'Deployment verification failed',
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );

      return {
        success: false,
        overallHealth: 'unhealthy',
        deployments: [],
        healthChecks: [],
        recommendations: ['Verification failed - manual check required'],
      };
    }
  }

  /**
   * Check individual deployment
   */
  private static async checkDeployment(
    url: string,
  ): Promise<DeploymentVerification> {
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'CostKatana-Verification/1.0',
        },
      });

      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;

      return {
        url,
        accessible: response.ok,
        responseTime,
        statusCode: response.status,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      return {
        url,
        accessible: false,
        responseTime,
        error: errorMessage,
      };
    }
  }

  /**
   * Verify data integrity after cross-integration operations
   */
  static async verifyDataIntegrity(
    sourceCount: number,
    targetCount: number,
    errors?: string[],
  ): Promise<DataIntegrityCheck> {
    const recordsSuccessful = targetCount;
    const recordsFailed = sourceCount - targetCount;
    const failureRate =
      sourceCount > 0 ? (recordsFailed / sourceCount) * 100 : 0;

    UniversalVerificationService.logger.log('📊 Data integrity check', {
      sourceCount,
      targetCount,
      failureRate: failureRate.toFixed(2) + '%',
    });

    return {
      recordsProcessed: sourceCount,
      recordsSuccessful,
      recordsFailed,
      failureRate,
      sampleErrors: errors?.slice(0, 5), // Max 5 sample errors
    };
  }

  /**
   * Main verification method for a governed task
   */
  static async verifyTask(task: any): Promise<VerificationResult> {
    try {
      UniversalVerificationService.logger.log('🔍 Verifying governed task', {
        taskId: task.id,
        taskType: task.classification?.type,
      });

      const taskType = task.classification?.type || 'unknown';
      const results = task.executionResults || {};

      // Extract URLs from task execution results
      const extractedUrls = this.extractTaskUrls(task);

      // Collect all deployment URLs
      const deploymentUrls: string[] = [
        ...extractedUrls.vercel,
        ...extractedUrls.github,
        ...extractedUrls.other,
      ];

      // Perform task-specific verification
      const verificationReport = await this.verifyTaskCompletion(taskType, {
        ...results,
        deploymentUrls,
      });

      // Generate rollback instructions if needed
      const rollbackInstructions = verificationReport.success
        ? undefined
        : this.generateRollbackInstructions(taskType, results);

      // Format response to match VerificationResult interface
      return {
        success: verificationReport.success,
        deploymentUrls,
        healthChecks:
          verificationReport.healthChecks?.map((hc) => ({
            name: hc.name,
            status: hc.status,
            details: hc.details,
          })) || [],
        dataIntegrity: verificationReport.dataIntegrity,
        recommendations: verificationReport.recommendations || [],
        rollbackInstructions,
        timestamp: new Date(),
      };
    } catch (error) {
      UniversalVerificationService.logger.error('Task verification failed', {
        taskId: task?.id,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        deploymentUrls: [],
        healthChecks: [],
        recommendations: ['Verification failed - manual review required'],
        timestamp: new Date(),
      };
    }
  }

  /**
   * Comprehensive verification for all task types
   */
  static async verifyTaskCompletion(
    taskType: string,
    results: any,
  ): Promise<{
    success: boolean;
    overallHealth: 'healthy' | 'degraded' | 'unhealthy';
    deployments?: DeploymentVerification[];
    healthChecks?: HealthCheckResult[];
    dataIntegrity?: DataIntegrityCheck;
    recommendations?: string[];
  }> {
    try {
      UniversalVerificationService.logger.log('✅ Verifying task completion', {
        taskType,
      });

      switch (taskType) {
        case 'coding':
        case 'deployment':
          if (results.deploymentUrls && results.deploymentUrls.length > 0) {
            return await this.verifyDeployments(results.deploymentUrls);
          }
          break;

        case 'cross_integration':
        case 'data_transformation':
          if (results.sourceCount && results.targetCount) {
            const dataIntegrity = await this.verifyDataIntegrity(
              results.sourceCount,
              results.targetCount,
              results.errors,
            );

            return {
              success: dataIntegrity.failureRate < 5, // Less than 5% failure
              overallHealth:
                dataIntegrity.failureRate < 5 ? 'healthy' : 'degraded',
              dataIntegrity,
              recommendations:
                dataIntegrity.failureRate > 0
                  ? ['Review failed records and retry if needed']
                  : [],
            };
          }
          break;

        default:
          // Simple success check for other task types
          return {
            success: true,
            overallHealth: 'healthy',
            recommendations: [],
          };
      }

      return {
        success: true,
        overallHealth: 'healthy',
        recommendations: [],
      };
    } catch (error) {
      UniversalVerificationService.logger.error('Task verification failed', {
        taskType,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        overallHealth: 'unhealthy',
        recommendations: ['Manual verification required due to error'],
      };
    }
  }

  /**
   * Generate rollback instructions
   */
  static generateRollbackInstructions(taskType: string, results: any): string {
    const instructions: string[] = [];

    switch (taskType) {
      case 'coding':
        if (results.githubRepo) {
          instructions.push(
            `- Delete GitHub repository: ${results.githubRepo}`,
          );
        }
        if (results.vercelDeployment) {
          instructions.push('- Delete Vercel deployment from dashboard');
        }
        if (results.awsResources) {
          instructions.push('- Terminate AWS resources via console or CLI');
        }
        break;

      case 'cross_integration':
        if (results.createdFiles) {
          instructions.push('- Delete created files from target integration');
        }
        break;

      case 'data_transformation':
        if (results.createdTickets) {
          instructions.push(
            `- Close/delete ${results.createdTickets.length} created tickets`,
          );
        }
        break;

      default:
        instructions.push('- No rollback needed for read-only operations');
    }

    return instructions.length > 0
      ? 'Rollback Instructions:\n' + instructions.join('\n')
      : 'No rollback required';
  }

  /**
   * Extract all URLs from task execution results
   */
  static extractTaskUrls(task: any): {
    github: string[];
    vercel: string[];
    other: string[];
  } {
    const urls = {
      github: [] as string[],
      vercel: [] as string[],
      other: [] as string[],
    };

    if (!task.executionResults || !Array.isArray(task.executionResults)) {
      return urls;
    }

    for (const result of task.executionResults) {
      // Check multiple possible URL locations
      const possibleUrls = [
        result.result?.output?.link,
        result.result?.output?.url,
        result.result?.output?.html_url,
        result.result?.data?.url,
        result.result?.data?.html_url,
        result.result?.url,
        result.result?.html_url,
      ];

      for (const url of possibleUrls) {
        if (url && typeof url === 'string') {
          if (url.includes('github.com')) {
            urls.github.push(url);
          } else if (url.includes('vercel.com') || url.includes('vercel.app')) {
            urls.vercel.push(url);
          } else if (url.startsWith('http')) {
            urls.other.push(url);
          }
        }
      }
    }

    // Remove duplicates
    urls.github = [...new Set(urls.github)];
    urls.vercel = [...new Set(urls.vercel)];
    urls.other = [...new Set(urls.other)];

    return urls;
  }
}
