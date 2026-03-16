import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../../common/logger/logger.service';
import {
  AWSConnection,
  AWSConnectionDocument,
} from '@/schemas/integration/aws-connection.schema';

export interface ActionRequest {
  service: string;
  action: string;
  region?: string;
}

export interface ValidationResult {
  allowed: boolean;
  reason?: string;
}

@Injectable()
export class PermissionBoundaryService {
  constructor(private readonly logger: LoggerService) {}

  /**
   * Validate action request without connection (e.g. for intent parsing).
   * Connection-specific enforcement happens at execution time.
   */
  checkBoundary(request: {
    action: string;
    service?: string;
    parameters?: Record<string, unknown>;
  }): ValidationResult {
    const allowedActions = new Set([
      'ec2.stop',
      'ec2.start',
      'ec2.resize',
      's3.lifecycle',
      's3.intelligent_tiering',
      'rds.stop',
      'rds.start',
      'rds.snapshot',
      'rds.resize',
      'lambda.update_memory',
      'lambda.update_timeout',
    ]);
    if (allowedActions.has(request.action)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `Action not in allowlist: ${request.action}`,
    };
  }

  /**
   * Validate if an action is allowed for the connection
   */
  validateAction(
    action: ActionRequest,
    connection: AWSConnectionDocument,
  ): ValidationResult {
    // Check if connection is active
    if (connection.status !== 'active') {
      return {
        allowed: false,
        reason: `Connection is not active (status: ${connection.status})`,
      };
    }

    // Check permission mode
    if (connection.permissionMode === 'read-only') {
      if (!this.isReadOnlyAction(action)) {
        return {
          allowed: false,
          reason: 'Read-only connection cannot perform write operations',
        };
      }
    }

    // Check custom permissions if applicable
    if (connection.permissionMode === 'custom') {
      return this.validateCustomPermissions(action, connection);
    }

    // Check denied actions
    if (connection.deniedActions?.includes(action.action)) {
      return {
        allowed: false,
        reason: `Action explicitly denied: ${action.action}`,
      };
    }

    // Check regions if specified
    if (action.region && connection.allowedRegions?.length) {
      if (!connection.allowedRegions.includes(action.region)) {
        return {
          allowed: false,
          reason: `Region not allowed: ${action.region}`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Validate custom permissions based on allowed services
   */
  private validateCustomPermissions(
    action: ActionRequest,
    connection: AWSConnection,
  ): ValidationResult {
    if (!connection.allowedServices?.length) {
      return {
        allowed: false,
        reason: 'No services configured for custom permissions',
      };
    }

    // Find matching service configuration
    const serviceConfig = connection.allowedServices.find(
      (service) => service.service === action.service,
    );

    if (!serviceConfig) {
      return {
        allowed: false,
        reason: `Service not configured: ${action.service}`,
      };
    }

    // Check if action is allowed
    if (!serviceConfig.actions.includes(action.action)) {
      return {
        allowed: false,
        reason: `Action not allowed for service ${action.service}: ${action.action}`,
      };
    }

    // Check regions if specified
    if (action.region && serviceConfig.regions.length > 0) {
      if (!serviceConfig.regions.includes(action.region)) {
        return {
          allowed: false,
          reason: `Region not allowed for service ${action.service}: ${action.region}`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Determine if an action is read-only
   */
  private isReadOnlyAction(action: ActionRequest): boolean {
    const readOnlyActions = [
      // Cost Explorer - all operations are read-only
      'GetCostAndUsage',
      'GetCostForecast',
      'GetAnomalies',
      'GetDimensionValues',

      // EC2 read operations
      'DescribeInstances',
      'DescribeImages',
      'DescribeSnapshots',

      // S3 read operations
      'ListBuckets',
      'ListObjects',
      'GetObject',

      // RDS read operations
      'DescribeDBInstances',

      // Lambda read operations
      'ListFunctions',
      'GetFunction',
    ];

    // Check if action starts with any read-only action
    return readOnlyActions.some((readAction) =>
      action.action.startsWith(readAction),
    );
  }

  /**
   * Get allowed actions for a connection
   */
  getAllowedActions(connection: AWSConnectionDocument): string[] {
    if (connection.status !== 'active') {
      return [];
    }

    if (connection.permissionMode === 'read-only') {
      return this.getReadOnlyActions();
    }

    if (connection.permissionMode === 'custom') {
      return this.getCustomAllowedActions(connection);
    }

    // Read-write mode
    return this.getReadWriteActions();
  }

  /**
   * Get read-only actions
   */
  private getReadOnlyActions(): string[] {
    return [
      // Cost Explorer
      'GetCostAndUsage',
      'GetCostForecast',
      'GetAnomalies',
      'GetDimensionValues',

      // EC2
      'DescribeInstances',
      'DescribeImages',
      'DescribeSnapshots',

      // S3
      'ListBuckets',
      'ListObjects',
      'GetObject',

      // RDS
      'DescribeDBInstances',

      // Lambda
      'ListFunctions',
      'GetFunction',
    ];
  }

  /**
   * Get read-write actions
   */
  private getReadWriteActions(): string[] {
    return [
      // Cost Explorer (read-only anyway)
      'GetCostAndUsage',
      'GetCostForecast',
      'GetAnomalies',
      'GetDimensionValues',

      // EC2
      'DescribeInstances',
      'StartInstances',
      'StopInstances',
      'TerminateInstances',
      'RunInstances',

      // S3
      'ListBuckets',
      'ListObjects',
      'GetObject',
      'PutObject',
      'DeleteObject',
      'CreateBucket',

      // RDS
      'DescribeDBInstances',
      'StartDBInstance',
      'StopDBInstance',

      // Lambda
      'ListFunctions',
      'GetFunction',
      'CreateFunction',
      'UpdateFunctionConfiguration',
    ];
  }

  /**
   * Get custom allowed actions based on connection configuration
   */
  private getCustomAllowedActions(connection: AWSConnection): string[] {
    if (!connection.allowedServices?.length) {
      return [];
    }

    const actions: string[] = [];
    for (const service of connection.allowedServices) {
      for (const action of service.actions) {
        actions.push(`${service.service}:${action}`);
      }
    }

    return actions;
  }

  /**
   * Check if connection allows dangerous operations
   */
  allowsDangerousOperations(connection: AWSConnectionDocument): boolean {
    if (connection.status !== 'active') {
      return false;
    }

    // Read-only connections never allow dangerous operations
    if (connection.permissionMode === 'read-only') {
      return false;
    }

    // Check for destructive actions in custom permissions
    if (connection.permissionMode === 'custom') {
      return (
        connection.allowedServices?.some((service) =>
          service.actions.some((action) =>
            this.isDangerousAction({ service: service.service, action }),
          ),
        ) || false
      );
    }

    // Read-write allows dangerous operations
    return true;
  }

  /**
   * Check if an action is considered dangerous
   */
  private isDangerousAction(action: ActionRequest): boolean {
    const dangerousActions = [
      'TerminateInstances',
      'DeleteObject',
      'DeleteBucket',
      'StopDBInstance',
      'DeleteDBInstance',
      'DeleteFunction',
    ];

    return dangerousActions.includes(action.action);
  }
}
