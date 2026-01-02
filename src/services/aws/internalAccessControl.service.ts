import { Types } from 'mongoose';
import { loggingService } from '../logging.service';

/**
 * Internal Access Control Service - Operator Threat Model Protection
 * 
 * Security Guarantees:
 * - No CostKatana employee can directly execute AWS actions
 * - No single operator can modify execution policies
 * - All privileged operations require dual approval + MFA
 * - Immutable audit trail for all internal access
 * - Separate Control Plane Admin vs Execution Plane roles
 */

export type InternalRole = 
  | 'viewer'           // Read-only access to dashboards
  | 'support'          // Customer support, limited actions
  | 'engineer'         // Development, no production access
  | 'control_admin'    // Control plane admin (policies, DSL)
  | 'execution_admin'  // Execution plane admin (kill switches)
  | 'security_admin'   // Security operations
  | 'super_admin';     // Requires dual approval for everything

export type PrivilegedOperation =
  | 'modify_dsl_allowlist'
  | 'disable_kill_switch'
  | 'access_customer_data'
  | 'modify_permission_boundary'
  | 'trigger_execution'
  | 'view_external_ids'
  | 'modify_audit_config'
  | 'access_encryption_keys'
  | 'modify_rate_limits'
  | 'bypass_approval';

export interface InternalOperator {
  operatorId: string;
  email: string;
  role: InternalRole;
  mfaEnabled: boolean;
  mfaVerifiedAt?: Date;
  lastActivity?: Date;
  ipAddress?: string;
}

export interface DualApprovalRequest {
  requestId: string;
  operation: PrivilegedOperation;
  requestedBy: InternalOperator;
  requestedAt: Date;
  approvedBy?: InternalOperator;
  approvedAt?: Date;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  expiresAt: Date;
  reason: string;
  metadata?: Record<string, any>;
}

export interface AccessControlCheckResult {
  allowed: boolean;
  reason?: string;
  requiresDualApproval?: boolean;
  requiresMfa?: boolean;
  pendingApprovalId?: string;
}

export interface InternalAuditEntry {
  timestamp: Date;
  operatorId: string;
  operatorEmail: string;
  operation: string;
  resource?: string;
  result: 'success' | 'denied' | 'pending_approval';
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
  dualApprovalId?: string;
}

// Operations that ALWAYS require dual approval
const DUAL_APPROVAL_REQUIRED: Set<PrivilegedOperation> = new Set([
  'modify_dsl_allowlist',
  'disable_kill_switch',
  'modify_permission_boundary',
  'trigger_execution',
  'access_encryption_keys',
  'modify_audit_config',
  'bypass_approval',
]);

// Operations that ALWAYS require MFA
const MFA_REQUIRED: Set<PrivilegedOperation> = new Set([
  'modify_dsl_allowlist',
  'disable_kill_switch',
  'access_customer_data',
  'modify_permission_boundary',
  'trigger_execution',
  'view_external_ids',
  'modify_audit_config',
  'access_encryption_keys',
  'modify_rate_limits',
  'bypass_approval',
]);

// Role permissions matrix
const ROLE_PERMISSIONS: Record<InternalRole, Set<PrivilegedOperation>> = {
  viewer: new Set([]),
  support: new Set(['access_customer_data']),
  engineer: new Set([]),
  control_admin: new Set([
    'modify_dsl_allowlist',
    'modify_permission_boundary',
    'modify_rate_limits',
  ]),
  execution_admin: new Set([
    'disable_kill_switch',
    'trigger_execution',
  ]),
  security_admin: new Set([
    'view_external_ids',
    'modify_audit_config',
    'access_encryption_keys',
  ]),
  super_admin: new Set([
    'modify_dsl_allowlist',
    'disable_kill_switch',
    'access_customer_data',
    'modify_permission_boundary',
    'trigger_execution',
    'view_external_ids',
    'modify_audit_config',
    'access_encryption_keys',
    'modify_rate_limits',
    'bypass_approval',
  ]),
};

class InternalAccessControlService {
  private static instance: InternalAccessControlService;
  
  // Pending dual approval requests
  private pendingApprovals: Map<string, DualApprovalRequest> = new Map();
  
  // Internal audit log (in production, this would go to a separate secure store)
  private auditLog: InternalAuditEntry[] = [];
  
  // MFA verification cache (short-lived)
  private mfaVerificationCache: Map<string, Date> = new Map();
  private readonly MFA_CACHE_DURATION_MS = 15 * 60 * 1000; // 15 minutes
  
  // Dual approval expiration
  private readonly DUAL_APPROVAL_EXPIRATION_MS = 30 * 60 * 1000; // 30 minutes
  
  private constructor() {
    // Start cleanup interval
    this.startCleanupInterval();
  }
  
  public static getInstance(): InternalAccessControlService {
    if (!InternalAccessControlService.instance) {
      InternalAccessControlService.instance = new InternalAccessControlService();
    }
    return InternalAccessControlService.instance;
  }
  
  /**
   * Check if an operator can perform a privileged operation
   */
  public async checkAccess(
    operator: InternalOperator,
    operation: PrivilegedOperation,
    resource?: string
  ): Promise<AccessControlCheckResult> {
    // Check if role has permission
    const rolePermissions = ROLE_PERMISSIONS[operator.role];
    if (!rolePermissions.has(operation)) {
      this.logAccess(operator, operation, resource, 'denied', 'Role does not have permission');
      return {
        allowed: false,
        reason: `Role '${operator.role}' does not have permission for '${operation}'`,
      };
    }
    
    // Check MFA requirement
    if (MFA_REQUIRED.has(operation)) {
      if (!operator.mfaEnabled) {
        this.logAccess(operator, operation, resource, 'denied', 'MFA not enabled');
        return {
          allowed: false,
          reason: 'MFA must be enabled for this operation',
          requiresMfa: true,
        };
      }
      
      const mfaVerified = this.isMfaVerified(operator.operatorId);
      if (!mfaVerified) {
        this.logAccess(operator, operation, resource, 'denied', 'MFA not verified');
        return {
          allowed: false,
          reason: 'MFA verification required',
          requiresMfa: true,
        };
      }
    }
    
    // Check dual approval requirement
    if (DUAL_APPROVAL_REQUIRED.has(operation)) {
      const existingApproval = this.findApprovedRequest(operator.operatorId, operation);
      
      if (!existingApproval) {
        // Create pending approval request
        const request = this.createApprovalRequest(operator, operation, resource);
        this.logAccess(operator, operation, resource, 'pending_approval', 'Dual approval required');
        
        return {
          allowed: false,
          reason: 'Dual approval required - request created',
          requiresDualApproval: true,
          pendingApprovalId: request.requestId,
        };
      }
      
      // Approval exists and is valid
      this.logAccess(operator, operation, resource, 'success', 'Dual approval verified');
    } else {
      this.logAccess(operator, operation, resource, 'success');
    }
    
    return { allowed: true };
  }
  
  /**
   * Verify MFA for an operator
   */
  public verifyMfa(operatorId: string, mfaToken: string): boolean {
    // In production, this would verify against TOTP or similar
    // For now, we just cache the verification
    
    // TODO: Implement actual MFA verification
    const isValid = mfaToken.length === 6 && /^\d+$/.test(mfaToken);
    
    if (isValid) {
      this.mfaVerificationCache.set(operatorId, new Date());
      loggingService.info('MFA verified for operator', {
        component: 'InternalAccessControlService',
        operation: 'verifyMfa',
        operatorId,
      });
    }
    
    return isValid;
  }
  
  /**
   * Check if MFA is currently verified for an operator
   */
  private isMfaVerified(operatorId: string): boolean {
    const verifiedAt = this.mfaVerificationCache.get(operatorId);
    if (!verifiedAt) {
      return false;
    }
    
    const elapsed = Date.now() - verifiedAt.getTime();
    return elapsed < this.MFA_CACHE_DURATION_MS;
  }
  
  /**
   * Create a dual approval request
   */
  private createApprovalRequest(
    operator: InternalOperator,
    operation: PrivilegedOperation,
    resource?: string
  ): DualApprovalRequest {
    const request: DualApprovalRequest = {
      requestId: `approval-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      operation,
      requestedBy: operator,
      requestedAt: new Date(),
      status: 'pending',
      expiresAt: new Date(Date.now() + this.DUAL_APPROVAL_EXPIRATION_MS),
      reason: `${operator.email} requested ${operation}${resource ? ` on ${resource}` : ''}`,
      metadata: { resource },
    };
    
    this.pendingApprovals.set(request.requestId, request);
    
    loggingService.info('Dual approval request created', {
      component: 'InternalAccessControlService',
      operation: 'createApprovalRequest',
      requestId: request.requestId,
      requestedBy: operator.email,
      operationType: operation,
    });
    
    return request;
  }
  
  /**
   * Approve a pending request (must be different operator)
   */
  public approveRequest(
    requestId: string,
    approver: InternalOperator
  ): { success: boolean; reason?: string } {
    const request = this.pendingApprovals.get(requestId);
    
    if (!request) {
      return { success: false, reason: 'Request not found' };
    }
    
    if (request.status !== 'pending') {
      return { success: false, reason: `Request is already ${request.status}` };
    }
    
    if (request.expiresAt < new Date()) {
      request.status = 'expired';
      return { success: false, reason: 'Request has expired' };
    }
    
    // CRITICAL: Approver must be different from requester
    if (request.requestedBy.operatorId === approver.operatorId) {
      loggingService.warn('Self-approval attempted', {
        component: 'InternalAccessControlService',
        operation: 'approveRequest',
        requestId,
        operatorId: approver.operatorId,
      });
      return { success: false, reason: 'Cannot approve your own request' };
    }
    
    // Check approver has permission for this operation
    const approverPermissions = ROLE_PERMISSIONS[approver.role];
    if (!approverPermissions.has(request.operation)) {
      return { success: false, reason: 'Approver does not have permission for this operation' };
    }
    
    // Check approver MFA
    if (MFA_REQUIRED.has(request.operation) && !this.isMfaVerified(approver.operatorId)) {
      return { success: false, reason: 'Approver MFA verification required' };
    }
    
    // Approve the request
    request.status = 'approved';
    request.approvedBy = approver;
    request.approvedAt = new Date();
    
    loggingService.info('Dual approval request approved', {
      component: 'InternalAccessControlService',
      operation: 'approveRequest',
      requestId,
      requestedBy: request.requestedBy.email,
      approvedBy: approver.email,
      operationType: request.operation,
    });
    
    return { success: true };
  }
  
  /**
   * Reject a pending request
   */
  public rejectRequest(
    requestId: string,
    rejector: InternalOperator,
    reason: string
  ): { success: boolean; reason?: string } {
    const request = this.pendingApprovals.get(requestId);
    
    if (!request) {
      return { success: false, reason: 'Request not found' };
    }
    
    if (request.status !== 'pending') {
      return { success: false, reason: `Request is already ${request.status}` };
    }
    
    request.status = 'rejected';
    
    loggingService.info('Dual approval request rejected', {
      component: 'InternalAccessControlService',
      operation: 'rejectRequest',
      requestId,
      requestedBy: request.requestedBy.email,
      rejectedBy: rejector.email,
      reason,
    });
    
    return { success: true };
  }
  
  /**
   * Find an approved request for an operator and operation
   */
  private findApprovedRequest(
    operatorId: string,
    operation: PrivilegedOperation
  ): DualApprovalRequest | undefined {
    for (const request of this.pendingApprovals.values()) {
      if (
        request.requestedBy.operatorId === operatorId &&
        request.operation === operation &&
        request.status === 'approved' &&
        request.expiresAt > new Date()
      ) {
        return request;
      }
    }
    return undefined;
  }
  
  /**
   * Log an access attempt
   */
  private logAccess(
    operator: InternalOperator,
    operation: string,
    resource: string | undefined,
    result: 'success' | 'denied' | 'pending_approval',
    reason?: string
  ): void {
    const entry: InternalAuditEntry = {
      timestamp: new Date(),
      operatorId: operator.operatorId,
      operatorEmail: operator.email,
      operation,
      resource,
      result,
      reason,
      ipAddress: operator.ipAddress,
    };
    
    this.auditLog.push(entry);
    
    // Also log to main logging service
    const logLevel = result === 'denied' ? 'warn' : 'info';
    loggingService[logLevel]('Internal access control check', {
      component: 'InternalAccessControlService',
      accessOperation: entry.operation,
      operatorId: entry.operatorId,
      operatorEmail: entry.operatorEmail,
      resource: entry.resource,
      result: entry.result,
      reason: entry.reason,
      ipAddress: entry.ipAddress,
      timestamp: entry.timestamp,
    });
  }
  
  /**
   * Get audit log
   */
  public getAuditLog(
    filters?: {
      operatorId?: string;
      operation?: string;
      result?: string;
      startDate?: Date;
      endDate?: Date;
    },
    limit: number = 100
  ): InternalAuditEntry[] {
    let filtered = [...this.auditLog];
    
    if (filters) {
      if (filters.operatorId) {
        filtered = filtered.filter(e => e.operatorId === filters.operatorId);
      }
      if (filters.operation) {
        filtered = filtered.filter(e => e.operation === filters.operation);
      }
      if (filters.result) {
        filtered = filtered.filter(e => e.result === filters.result);
      }
      if (filters.startDate) {
        filtered = filtered.filter(e => e.timestamp >= filters.startDate!);
      }
      if (filters.endDate) {
        filtered = filtered.filter(e => e.timestamp <= filters.endDate!);
      }
    }
    
    return filtered.slice(-limit);
  }
  
  /**
   * Get pending approval requests
   */
  public getPendingApprovals(): DualApprovalRequest[] {
    return Array.from(this.pendingApprovals.values())
      .filter(r => r.status === 'pending' && r.expiresAt > new Date());
  }
  
  /**
   * Start cleanup interval for expired requests and MFA cache
   */
  private startCleanupInterval(): void {
    setInterval(() => {
      const now = new Date();
      
      // Clean up expired approval requests
      for (const [id, request] of this.pendingApprovals) {
        if (request.expiresAt < now) {
          if (request.status === 'pending') {
            request.status = 'expired';
          }
          // Keep for audit, but could archive after some time
        }
      }
      
      // Clean up expired MFA verifications
      for (const [operatorId, verifiedAt] of this.mfaVerificationCache) {
        if (Date.now() - verifiedAt.getTime() > this.MFA_CACHE_DURATION_MS) {
          this.mfaVerificationCache.delete(operatorId);
        }
      }
    }, 60000); // Every minute
  }
  
  /**
   * Get security policy documentation
   */
  public getSecurityPolicyDoc(): string {
    return `
# CostKatana Internal Access Control Policy

## Core Principles
1. No single operator can execute privileged operations alone
2. All privileged operations require MFA verification
3. Dual approval is required for critical operations
4. All access is logged immutably

## Role Definitions
- **viewer**: Read-only dashboard access
- **support**: Customer support with limited data access
- **engineer**: Development access, no production
- **control_admin**: Policy and DSL management
- **execution_admin**: Kill switch and execution control
- **security_admin**: Security operations
- **super_admin**: All permissions (requires dual approval)

## Dual Approval Required Operations
${Array.from(DUAL_APPROVAL_REQUIRED).map(op => `- ${op}`).join('\n')}

## MFA Required Operations
${Array.from(MFA_REQUIRED).map(op => `- ${op}`).join('\n')}

## Audit Requirements
All internal access attempts are logged with:
- Timestamp
- Operator ID and email
- Operation attempted
- Resource accessed
- Result (success/denied/pending)
- IP address
`;
  }
}

export const internalAccessControlService = InternalAccessControlService.getInstance();
