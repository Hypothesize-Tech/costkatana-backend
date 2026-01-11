import { loggingService } from './logging.service';

export interface HealthCheckResult {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime?: number;
  details: any;
  timestamp: Date;
}

export interface DeploymentVerification {
  url: string;
  accessible: boolean;
  responseTime: number;
  statusCode?: number;
  error?: string;
}

export interface DataIntegrityCheck {
  recordsProcessed: number;
  recordsSuccessful: number;
  recordsFailed: number;
  failureRate: number;
  sampleErrors?: string[];
}

export interface VerificationReport {
  success: boolean;
  overallHealth: 'healthy' | 'degraded' | 'unhealthy';
  deployments?: DeploymentVerification[];
  healthChecks?: HealthCheckResult[];
  dataIntegrity?: DataIntegrityCheck;
  recommendations?: string[];
  rollbackInstructions?: string;
}

export class UniversalVerificationService {
  /**
   * Verify deployment URLs are accessible and healthy
   */
  static async verifyDeployments(urls: string[]): Promise<VerificationReport> {
    try {
      loggingService.info('🔍 Verifying deployments', {
        component: 'UniversalVerificationService',
        operation: 'verifyDeployments',
        urlsCount: urls.length
      });

      const deployments = await Promise.all(
        urls.map(url => this.checkDeployment(url))
      );

      const allAccessible = deployments.every(d => d.accessible);
      const avgResponseTime = deployments.reduce((sum, d) => sum + d.responseTime, 0) / deployments.length;

      const healthChecks: HealthCheckResult[] = deployments.map(d => ({
        name: `Deployment: ${d.url}`,
        status: d.accessible ? 'healthy' : 'unhealthy',
        responseTime: d.responseTime,
        details: { statusCode: d.statusCode, error: d.error },
        timestamp: new Date()
      }));

      const recommendations: string[] = [];
      if (avgResponseTime > 1000) {
        recommendations.push('High response times detected - consider performance optimization');
      }
      if (!allAccessible) {
        recommendations.push('Some deployments are not accessible - check logs and configurations');
      }

      return {
        success: allAccessible,
        overallHealth: allAccessible ? (avgResponseTime < 500 ? 'healthy' : 'degraded') : 'unhealthy',
        deployments,
        healthChecks,
        recommendations
      };

    } catch (error) {
      loggingService.error('Deployment verification failed', {
        component: 'UniversalVerificationService',
        operation: 'verifyDeployments',
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        overallHealth: 'unhealthy',
        recommendations: ['Verification failed - manual check required']
      };
    }
  }

  /**
   * Check individual deployment
   */
  private static async checkDeployment(url: string): Promise<DeploymentVerification> {
    const startTime = Date.now();

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });

      const responseTime = Date.now() - startTime;

      return {
        url,
        accessible: response.ok,
        responseTime,
        statusCode: response.status
      };

    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      return {
        url,
        accessible: false,
        responseTime,
        error: errorMessage
      };
    }
  }

  /**
   * Verify data integrity after cross-integration operations
   */
  static async verifyDataIntegrity(
    sourceCount: number,
    targetCount: number,
    errors?: string[]
  ): Promise<DataIntegrityCheck> {
    const recordsSuccessful = targetCount;
    const recordsFailed = sourceCount - targetCount;
    const failureRate = sourceCount > 0 ? (recordsFailed / sourceCount) * 100 : 0;

    loggingService.info('📊 Data integrity check', {
      component: 'UniversalVerificationService',
      operation: 'verifyDataIntegrity',
      sourceCount,
      targetCount,
      failureRate: failureRate.toFixed(2) + '%'
    });

    return {
      recordsProcessed: sourceCount,
      recordsSuccessful,
      recordsFailed,
      failureRate,
      sampleErrors: errors?.slice(0, 5) // Max 5 sample errors
    };
  }

  /**
   * Main verification method for a governed task
   */
  static async verifyTask(task: any): Promise<any> {
    try {
      loggingService.info('🔍 Verifying governed task', {
        component: 'UniversalVerificationService',
        operation: 'verifyTask',
        taskId: task.id,
        taskType: task.classification?.type
      });

      const taskType = task.classification?.type || 'unknown';
      const results = task.executionResults || {};

      // Import GovernedAgentService to extract URLs
      const { GovernedAgentService } = await import('./governedAgent.service');
      const extractedUrls = GovernedAgentService.extractTaskUrls(task);
      
      // Collect all deployment URLs
      const deploymentUrls: string[] = [
        ...extractedUrls.vercel,
        ...extractedUrls.github,
        ...extractedUrls.other
      ];

      // Perform task-specific verification
      const verificationReport = await this.verifyTaskCompletion(taskType, {
        ...results,
        deploymentUrls
      });

      // Generate rollback instructions if needed
      const rollbackInstructions = verificationReport.success 
        ? undefined 
        : this.generateRollbackInstructions(taskType, results);

      // Format response to match VerificationResult interface
      return {
        success: verificationReport.success,
        deploymentUrls,
        healthChecks: verificationReport.healthChecks?.map(hc => ({
          name: hc.name,
          status: hc.status,
          details: hc.details
        })) || [],
        dataIntegrity: verificationReport.dataIntegrity,
        recommendations: verificationReport.recommendations || [],
        rollbackInstructions,
        timestamp: new Date(),
        urls: extractedUrls
      };

    } catch (error) {
      loggingService.error('Task verification failed', {
        component: 'UniversalVerificationService',
        operation: 'verifyTask',
        taskId: task?.id,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        deploymentUrls: [],
        healthChecks: [],
        recommendations: ['Verification failed - manual review required'],
        rollbackInstructions: 'Manual rollback required',
        timestamp: new Date()
      };
    }
  }

  /**
   * Comprehensive verification for all task types
   */
  static async verifyTaskCompletion(
    taskType: string,
    results: any
  ): Promise<VerificationReport> {
    try {
      loggingService.info('✅ Verifying task completion', {
        component: 'UniversalVerificationService',
        operation: 'verifyTaskCompletion',
        taskType
      });

      switch (taskType) {
        case 'coding':
        case 'deployment':
          if (results.deploymentUrls) {
            return await this.verifyDeployments(results.deploymentUrls);
          }
          break;

        case 'cross_integration':
        case 'data_transformation':
          if (results.sourceCount && results.targetCount) {
            const dataIntegrity = await this.verifyDataIntegrity(
              results.sourceCount,
              results.targetCount,
              results.errors
            );

            return {
              success: dataIntegrity.failureRate < 5, // Less than 5% failure
              overallHealth: dataIntegrity.failureRate < 5 ? 'healthy' : 'degraded',
              dataIntegrity,
              recommendations: dataIntegrity.failureRate > 0 
                ? ['Review failed records and retry if needed']
                : []
            };
          }
          break;

        default:
          // Simple success check for other task types
          return {
            success: true,
            overallHealth: 'healthy',
            recommendations: []
          };
      }

      return {
        success: true,
        overallHealth: 'healthy',
        recommendations: []
      };

    } catch (error) {
      loggingService.error('Task verification failed', {
        component: 'UniversalVerificationService',
        operation: 'verifyTaskCompletion',
        taskType,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        overallHealth: 'unhealthy',
        recommendations: ['Manual verification required due to error']
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
          instructions.push(`- Delete GitHub repository: ${results.githubRepo}`);
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
          instructions.push(`- Close/delete ${results.createdTickets.length} created tickets`);
        }
        break;

      default:
        instructions.push('- No rollback needed for read-only operations');
    }

    return instructions.length > 0
      ? 'Rollback Instructions:\n' + instructions.join('\n')
      : 'No rollback required';
  }
}
