import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Types } from 'mongoose';
import { LoggerService } from '../../../common/logger/logger.service';
import {
  AWSConnection,
  AWSConnectionDocument,
} from '../../../schemas/integration/aws-connection.schema';

/**
 * Permission Validator Service
 *
 * Enforces granular IAM permissions before allowing AWS actions.
 * This is the enforcement layer that ensures users can only execute
 * actions they explicitly granted permission for.
 */

export interface PermissionValidationResult {
  allowed: boolean;
  reason?: string;
  deniedActions?: string[];
  allowedActions?: string[];
  service?: string;
}

@Injectable()
export class PermissionValidatorService {
  constructor(
    @InjectModel(AWSConnection.name)
    private awsConnectionModel: Model<AWSConnectionDocument>,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Validate if a specific action is allowed for a connection
   */
  async validateAction(
    connectionId: Types.ObjectId,
    action: string,
    region?: string,
  ): Promise<PermissionValidationResult> {
    try {
      const connection = await this.awsConnectionModel.findById(connectionId);

      if (!connection) {
        return {
          allowed: false,
          reason: 'Connection not found',
        };
      }

      if (connection.status !== 'active') {
        return {
          allowed: false,
          reason: `Connection is ${connection.status}`,
        };
      }

      // Extract service from action (e.g., 'ec2:StartInstances' -> 'ec2')
      const [service] = action.split(':');

      // Check if service is in allowed services
      const allowedService = connection.allowedServices.find(
        (s) => s.service === service,
      );

      if (!allowedService) {
        this.logger.warn('Service not allowed in connection', {
          component: 'PermissionValidatorService',
          operation: 'validateAction',
          connectionId: connectionId.toString(),
          service,
          action,
        });

        return {
          allowed: false,
          reason: `Service '${service}' is not enabled for this connection`,
          service,
        };
      }

      // Check if region is allowed (if region is specified)
      if (
        region &&
        allowedService.regions.length > 0 &&
        !allowedService.regions.includes('*')
      ) {
        if (!allowedService.regions.includes(region)) {
          return {
            allowed: false,
            reason: `Region '${region}' is not allowed for service '${service}'`,
            service,
          };
        }
      }

      // Check if specific action is allowed
      const isActionAllowed = this.matchesActionPattern(
        action,
        allowedService.actions,
      );

      if (!isActionAllowed) {
        this.logger.warn('Action not allowed in connection', {
          component: 'PermissionValidatorService',
          operation: 'validateAction',
          connectionId: connectionId.toString(),
          service,
          action,
          allowedActions: allowedService.actions,
        });

        return {
          allowed: false,
          reason: `Action '${action}' is not permitted. Allowed actions: ${allowedService.actions.join(', ')}`,
          service,
          allowedActions: allowedService.actions,
        };
      }

      this.logger.log('Action validated successfully', {
        component: 'PermissionValidatorService',
        operation: 'validateAction',
        connectionId: connectionId.toString(),
        service,
        action,
      });

      return {
        allowed: true,
        service,
        allowedActions: allowedService.actions,
      };
    } catch (error) {
      this.logger.error('Error validating action', {
        component: 'PermissionValidatorService',
        operation: 'validateAction',
        error: error instanceof Error ? error.message : String(error),
        connectionId: connectionId.toString(),
        action,
      });

      return {
        allowed: false,
        reason: 'Internal error during permission validation',
      };
    }
  }

  /**
   * Validate multiple actions at once
   */
  async validateActions(
    connectionId: Types.ObjectId,
    actions: string[],
    region?: string,
  ): Promise<PermissionValidationResult> {
    const deniedActions: string[] = [];
    const allowedActions: string[] = [];

    for (const action of actions) {
      const result = await this.validateAction(connectionId, action, region);
      if (result.allowed) {
        allowedActions.push(action);
      } else {
        deniedActions.push(action);
      }
    }

    if (deniedActions.length > 0) {
      return {
        allowed: false,
        reason: `${deniedActions.length} action(s) denied: ${deniedActions.join(', ')}`,
        deniedActions,
        allowedActions,
      };
    }

    return {
      allowed: true,
      allowedActions,
    };
  }

  /**
   * Match action against patterns (supports wildcards)
   * e.g., 'ec2:Describe*' matches 'ec2:DescribeInstances'
   */
  private matchesActionPattern(action: string, patterns: string[]): boolean {
    return patterns.some((pattern) => {
      // Convert wildcard pattern to regex
      const regexPattern = pattern.replace(/\*/g, '.*').replace(/\?/g, '.');

      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(action);
    });
  }

  /**
   * Get summary of allowed permissions for a connection
   */
  async getPermissionSummary(connectionId: Types.ObjectId): Promise<{
    totalServices: number;
    totalActions: number;
    services: Array<{
      service: string;
      actionCount: number;
      regions: string[];
    }>;
  }> {
    const connection = await this.awsConnectionModel.findById(connectionId);

    if (!connection) {
      return {
        totalServices: 0,
        totalActions: 0,
        services: [],
      };
    }

    const services = connection.allowedServices.map((s) => ({
      service: s.service,
      actionCount: s.actions.length,
      regions: s.regions,
    }));

    return {
      totalServices: connection.allowedServices.length,
      totalActions: connection.allowedServices.reduce(
        (sum, s) => sum + s.actions.length,
        0,
      ),
      services,
    };
  }

  /**
   * Check if connection has write permissions
   */
  async hasWritePermissions(connectionId: Types.ObjectId): Promise<boolean> {
    const connection = await this.awsConnectionModel.findById(connectionId);

    if (!connection) {
      return false;
    }

    // Check if any action is a write action (not Describe, List, or Get)
    return connection.allowedServices.some((service) =>
      service.actions.some((action) => {
        const [, actionName] = action.split(':');
        return !(
          actionName.startsWith('Describe') ||
          actionName.startsWith('List') ||
          actionName.startsWith('Get')
        );
      }),
    );
  }
}
