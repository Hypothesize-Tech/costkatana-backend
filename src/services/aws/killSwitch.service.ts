import { Types } from 'mongoose';
import { loggingService } from '../logging.service';

/**
 * Dual Kill Switch System - Emergency Stop Capability
 * 
 * Security Guarantees:
 * - Global kill switch (freeze all executions)
 * - Per-customer kill switch
 * - Per-service kill switch
 * - Read-only mode fallback
 * - Both CostKatana-side and customer-side kill switches
 * 
 * Customer-side kill switch methods:
 * 1. Delete the IAM role entirely
 * 2. Remove CostKatana from trust policy
 * 3. Add explicit Deny for sts:AssumeRole
 * 4. Set permission boundary to deny all
 */

export type KillSwitchScope = 'global' | 'customer' | 'service' | 'connection';
export type KillSwitchReason = 
  | 'security_incident'
  | 'cost_anomaly'
  | 'manual_activation'
  | 'rate_limit_exceeded'
  | 'compliance_violation'
  | 'customer_request'
  | 'system_maintenance';

export interface KillSwitchState {
  global: boolean;
  readOnlyMode: boolean;
  perCustomer: Map<string, KillSwitchEntry>;
  perService: Map<string, KillSwitchEntry>;
  perConnection: Map<string, KillSwitchEntry>;
}

export interface KillSwitchEntry {
  active: boolean;
  activatedAt: Date;
  activatedBy: string;
  reason: KillSwitchReason;
  expiresAt?: Date;
  notes?: string;
}

export interface KillSwitchActivation {
  scope: KillSwitchScope;
  id?: string;
  reason: KillSwitchReason;
  activatedBy: string;
  expiresAt?: Date;
  notes?: string;
}

export interface ExecutionRequest {
  customerId: string;
  connectionId: string;
  service: string;
  action: string;
  isWrite: boolean;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface KillSwitchCheckResult {
  allowed: boolean;
  reason?: string;
  scope?: KillSwitchScope;
  switchEntry?: KillSwitchEntry;
}

// Customer-side kill switch documentation
export const CUSTOMER_KILL_SWITCH_METHODS = {
  DELETE_ROLE: {
    method: 'Delete the IAM role entirely',
    description: 'Immediately revokes all access. CostKatana cannot assume a deleted role.',
    reversible: true,
    timeToEffect: 'Immediate',
  },
  REMOVE_TRUST: {
    method: 'Remove CostKatana from trust policy',
    description: 'Edit the role trust policy to remove the CostKatana AWS account.',
    reversible: true,
    timeToEffect: 'Immediate',
  },
  DENY_ASSUME: {
    method: 'Add explicit Deny for sts:AssumeRole',
    description: 'Add a Deny statement in the trust policy for sts:AssumeRole.',
    reversible: true,
    timeToEffect: 'Immediate',
  },
  PERMISSION_BOUNDARY: {
    method: 'Set permission boundary to deny all',
    description: 'Attach a permission boundary that denies all actions.',
    reversible: true,
    timeToEffect: 'Immediate',
  },
} as const;

class KillSwitchService {
  private static instance: KillSwitchService;
  
  private state: KillSwitchState = {
    global: false,
    readOnlyMode: false,
    perCustomer: new Map(),
    perService: new Map(),
    perConnection: new Map(),
  };
  
  // Audit log for kill switch operations
  private auditLog: Array<{
    timestamp: Date;
    operation: 'activate' | 'deactivate';
    scope: KillSwitchScope;
    id?: string;
    activatedBy: string;
    reason?: KillSwitchReason;
  }> = [];
  
  private constructor() {
    // Start expiration checker
    this.startExpirationChecker();
  }
  
  public static getInstance(): KillSwitchService {
    if (!KillSwitchService.instance) {
      KillSwitchService.instance = new KillSwitchService();
    }
    return KillSwitchService.instance;
  }
  
  /**
   * Activate a kill switch
   * This immediately stops all affected executions
   */
  public async activateKillSwitch(activation: KillSwitchActivation): Promise<void> {
    const entry: KillSwitchEntry = {
      active: true,
      activatedAt: new Date(),
      activatedBy: activation.activatedBy,
      reason: activation.reason,
      expiresAt: activation.expiresAt,
      notes: activation.notes,
    };
    
    switch (activation.scope) {
      case 'global':
        this.state.global = true;
        loggingService.error('CRITICAL: Global kill switch activated', {
          component: 'KillSwitchService',
          operation: 'activateKillSwitch',
          scope: 'global',
          reason: activation.reason,
          activatedBy: activation.activatedBy,
        });
        break;
        
      case 'customer':
        if (!activation.id) {
          throw new Error('Customer ID required for customer-scoped kill switch');
        }
        this.state.perCustomer.set(activation.id, entry);
        loggingService.warn('Customer kill switch activated', {
          component: 'KillSwitchService',
          operation: 'activateKillSwitch',
          scope: 'customer',
          customerId: activation.id,
          reason: activation.reason,
        });
        break;
        
      case 'service':
        if (!activation.id) {
          throw new Error('Service name required for service-scoped kill switch');
        }
        this.state.perService.set(activation.id, entry);
        loggingService.warn('Service kill switch activated', {
          component: 'KillSwitchService',
          operation: 'activateKillSwitch',
          scope: 'service',
          service: activation.id,
          reason: activation.reason,
        });
        break;
        
      case 'connection':
        if (!activation.id) {
          throw new Error('Connection ID required for connection-scoped kill switch');
        }
        this.state.perConnection.set(activation.id, entry);
        loggingService.warn('Connection kill switch activated', {
          component: 'KillSwitchService',
          operation: 'activateKillSwitch',
          scope: 'connection',
          connectionId: activation.id,
          reason: activation.reason,
        });
        break;
    }
    
    // Record in audit log
    this.auditLog.push({
      timestamp: new Date(),
      operation: 'activate',
      scope: activation.scope,
      id: activation.id,
      activatedBy: activation.activatedBy,
      reason: activation.reason,
    });
  }
  
  /**
   * Deactivate a kill switch
   */
  public async deactivateKillSwitch(
    scope: KillSwitchScope,
    id: string | undefined,
    deactivatedBy: string
  ): Promise<void> {
    switch (scope) {
      case 'global':
        this.state.global = false;
        loggingService.info('Global kill switch deactivated', {
          component: 'KillSwitchService',
          operation: 'deactivateKillSwitch',
          scope: 'global',
          deactivatedBy,
        });
        break;
        
      case 'customer':
        if (id) {
          this.state.perCustomer.delete(id);
        }
        break;
        
      case 'service':
        if (id) {
          this.state.perService.delete(id);
        }
        break;
        
      case 'connection':
        if (id) {
          this.state.perConnection.delete(id);
        }
        break;
    }
    
    // Record in audit log
    this.auditLog.push({
      timestamp: new Date(),
      operation: 'deactivate',
      scope,
      id,
      activatedBy: deactivatedBy,
    });
  }
  
  /**
   * Enable read-only mode
   * All write operations are blocked, but reads continue
   */
  public enableReadOnlyMode(activatedBy: string, reason: KillSwitchReason): void {
    this.state.readOnlyMode = true;
    
    loggingService.warn('Read-only mode enabled', {
      component: 'KillSwitchService',
      operation: 'enableReadOnlyMode',
      activatedBy,
      reason,
    });
    
    this.auditLog.push({
      timestamp: new Date(),
      operation: 'activate',
      scope: 'global',
      activatedBy,
      reason,
    });
  }
  
  /**
   * Disable read-only mode
   */
  public disableReadOnlyMode(deactivatedBy: string): void {
    this.state.readOnlyMode = false;
    
    loggingService.info('Read-only mode disabled', {
      component: 'KillSwitchService',
      operation: 'disableReadOnlyMode',
      deactivatedBy,
    });
  }
  
  /**
   * Check if an execution request is allowed
   * This is the main entry point for kill switch checks
   */
  public checkKillSwitch(request: ExecutionRequest): KillSwitchCheckResult {
    // Check global kill switch first
    if (this.state.global) {
      return {
        allowed: false,
        reason: 'Global kill switch is active - all executions blocked',
        scope: 'global',
      };
    }
    
    // Check read-only mode for write operations
    if (this.state.readOnlyMode && request.isWrite) {
      return {
        allowed: false,
        reason: 'Read-only mode is active - write operations blocked',
        scope: 'global',
      };
    }
    
    // Check customer-specific kill switch
    const customerSwitch = this.state.perCustomer.get(request.customerId);
    if (customerSwitch?.active) {
      return {
        allowed: false,
        reason: `Customer kill switch active: ${customerSwitch.reason}`,
        scope: 'customer',
        switchEntry: customerSwitch,
      };
    }
    
    // Check service-specific kill switch
    const serviceSwitch = this.state.perService.get(request.service);
    if (serviceSwitch?.active) {
      return {
        allowed: false,
        reason: `Service kill switch active for ${request.service}: ${serviceSwitch.reason}`,
        scope: 'service',
        switchEntry: serviceSwitch,
      };
    }
    
    // Check connection-specific kill switch
    const connectionSwitch = this.state.perConnection.get(request.connectionId);
    if (connectionSwitch?.active) {
      return {
        allowed: false,
        reason: `Connection kill switch active: ${connectionSwitch.reason}`,
        scope: 'connection',
        switchEntry: connectionSwitch,
      };
    }
    
    return { allowed: true };
  }
  
  /**
   * Get current kill switch state (for admin dashboard)
   */
  public getState(): {
    global: boolean;
    readOnlyMode: boolean;
    customerSwitchCount: number;
    serviceSwitchCount: number;
    connectionSwitchCount: number;
  } {
    return {
      global: this.state.global,
      readOnlyMode: this.state.readOnlyMode,
      customerSwitchCount: this.state.perCustomer.size,
      serviceSwitchCount: this.state.perService.size,
      connectionSwitchCount: this.state.perConnection.size,
    };
  }
  
  /**
   * Get detailed state for a specific scope
   */
  public getScopeState(scope: KillSwitchScope): KillSwitchEntry[] {
    switch (scope) {
      case 'customer':
        return Array.from(this.state.perCustomer.values());
      case 'service':
        return Array.from(this.state.perService.values());
      case 'connection':
        return Array.from(this.state.perConnection.values());
      default:
        return [];
    }
  }
  
  /**
   * Get audit log
   */
  public getAuditLog(limit: number = 100): typeof this.auditLog {
    return this.auditLog.slice(-limit);
  }
  
  /**
   * Get customer-side kill switch documentation
   */
  public getCustomerKillSwitchMethods(): typeof CUSTOMER_KILL_SWITCH_METHODS {
    return CUSTOMER_KILL_SWITCH_METHODS;
  }
  
  /**
   * Generate emergency stop instructions for a customer
   */
  public getEmergencyStopInstructions(roleArn: string): string {
    return `
# Emergency Stop Instructions for CostKatana Access

If you need to immediately stop CostKatana from accessing your AWS account, 
use any of the following methods:

## Method 1: Delete the IAM Role (Fastest)
\`\`\`bash
aws iam delete-role --role-name ${roleArn.split('/').pop()}
\`\`\`

## Method 2: Remove Trust Relationship
Edit the role's trust policy to remove CostKatana's AWS account.

## Method 3: Add Explicit Deny
Add this statement to your role's trust policy:
\`\`\`json
{
  "Effect": "Deny",
  "Principal": {
    "AWS": "arn:aws:iam::${process.env.COSTKATANA_AWS_ACCOUNT_ID}:root"
  },
  "Action": "sts:AssumeRole"
}
\`\`\`

## Important Notes
- Active sessions expire within 15 minutes maximum
- Deleting the role immediately prevents new sessions
- CostKatana has no persistent access to your account
- Your AWS resources continue operating normally

## Contact Support
If you believe there's a security incident, contact us immediately:
- Email: security@costkatana.com
- Emergency: +1-XXX-XXX-XXXX
`;
  }
  
  /**
   * Start background checker for expired kill switches
   */
  private startExpirationChecker(): void {
    setInterval(() => {
      const now = new Date();
      
      // Check customer switches
      for (const [id, entry] of this.state.perCustomer) {
        if (entry.expiresAt && entry.expiresAt < now) {
          this.state.perCustomer.delete(id);
          loggingService.info('Customer kill switch expired', {
            component: 'KillSwitchService',
            customerId: id,
          });
        }
      }
      
      // Check service switches
      for (const [id, entry] of this.state.perService) {
        if (entry.expiresAt && entry.expiresAt < now) {
          this.state.perService.delete(id);
          loggingService.info('Service kill switch expired', {
            component: 'KillSwitchService',
            service: id,
          });
        }
      }
      
      // Check connection switches
      for (const [id, entry] of this.state.perConnection) {
        if (entry.expiresAt && entry.expiresAt < now) {
          this.state.perConnection.delete(id);
          loggingService.info('Connection kill switch expired', {
            component: 'KillSwitchService',
            connectionId: id,
          });
        }
      }
    }, 60000); // Check every minute
  }
}

export const killSwitchService = KillSwitchService.getInstance();
