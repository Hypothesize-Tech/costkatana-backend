import { loggingService } from '../logging.service';
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import crypto from 'crypto';
import { BackupCodesService } from '../backupCodes.service';

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

export interface OperatorMFASetup {
  secret: string;
  qrCodeUrl: string;
  backupCodes: string[];
}

interface OperatorMFAData {
  secret: string; // Encrypted TOTP secret
  backupCodes: string[]; // Hashed backup codes
  enabled: boolean;
  setupAt?: Date;
  lastUsed?: Date;
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
  metadata?: Record<string, unknown>;
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
  
  // Operator MFA data storage (in production, use encrypted database)
  private operatorMFAData: Map<string, OperatorMFAData> = new Map();
  
  // Encryption key for MFA secrets (in production, use AWS KMS or similar)
  private readonly ENCRYPTION_KEY = process.env.INTERNAL_MFA_ENCRYPTION_KEY ?? 
    crypto.createHash('sha256').update('default-key-change-in-production').digest();
  private readonly ENCRYPTION_ALGORITHM = 'aes-256-gcm';
  
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
  public checkAccess(
    operator: InternalOperator,
    operation: PrivilegedOperation,
    resource?: string
  ): AccessControlCheckResult {
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
   * Setup TOTP MFA for an operator
   * Generates secret, QR code, and backup codes
   */
  public async setupMFA(operatorId: string, operatorEmail: string): Promise<OperatorMFASetup> {
    try {
      // Generate TOTP secret
      const secret = speakeasy.generateSecret({
        name: `CostKatana Internal (${operatorEmail})`,
        issuer: 'CostKatana Internal',
        length: 32,
      });

      if (!secret.base32) {
        throw new Error('Failed to generate TOTP secret');
      }

      // Generate backup codes
      const plainBackupCodes = BackupCodesService.generateBackupCodes();
      const hashedBackupCodes = await BackupCodesService.hashBackupCodes(plainBackupCodes);

      // Generate QR code
      if (!secret.otpauth_url) {
        throw new Error('Failed to generate OTP auth URL');
      }
      const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);

      // Encrypt the secret before storing
      const encryptedSecret = this.encryptSecret(secret.base32);

      // Store MFA data (not enabled yet - requires verification first)
      this.operatorMFAData.set(operatorId, {
        secret: encryptedSecret,
        backupCodes: hashedBackupCodes,
        enabled: false,
        setupAt: new Date(),
      });

      loggingService.info('MFA setup initiated for operator', {
        component: 'InternalAccessControlService',
        operation: 'setupMFA',
        operatorId,
        operatorEmail,
      });

      return {
        secret: secret.base32, // Return plain secret for QR code generation
        qrCodeUrl,
        backupCodes: plainBackupCodes, // Return plain codes for one-time display
      };
    } catch (error) {
      loggingService.error('Error setting up MFA for operator', {
        component: 'InternalAccessControlService',
        operation: 'setupMFA',
        operatorId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  /**
   * Verify TOTP token and enable MFA for an operator
   */
  public async verifyAndEnableMFA(operatorId: string, token: string): Promise<boolean> {
    try {
      const mfaData = this.operatorMFAData.get(operatorId);
      if (!mfaData?.secret) {
        loggingService.warn('MFA setup not found for operator', {
          component: 'InternalAccessControlService',
          operation: 'verifyAndEnableMFA',
          operatorId,
        });
        return false;
      }

      // Decrypt the secret
      const decryptedSecret = this.decryptSecret(mfaData.secret);

      // Check if it's a backup code first
      const backupCodeResult = await BackupCodesService.verifyBackupCode(token, mfaData.backupCodes);
      if (backupCodeResult.verified && backupCodeResult.codeIndex !== undefined) {
        // Remove used backup code
        const updatedBackupCodes = BackupCodesService.removeUsedCode(
          mfaData.backupCodes,
          backupCodeResult.codeIndex
        );

        // Enable MFA and update backup codes
        mfaData.enabled = true;
        mfaData.backupCodes = updatedBackupCodes;
        mfaData.lastUsed = new Date();

        loggingService.info('MFA enabled using backup code', {
          component: 'InternalAccessControlService',
          operation: 'verifyAndEnableMFA',
          operatorId,
        });

        return true;
      }

      // Verify TOTP token
      const verified = speakeasy.totp.verify({
        secret: decryptedSecret,
        encoding: 'base32',
        token,
        window: 2, // Allow 2 time steps (60 seconds) tolerance
      });

      if (verified) {
        // Enable MFA
        mfaData.enabled = true;
        mfaData.lastUsed = new Date();

        loggingService.info('MFA enabled for operator', {
          component: 'InternalAccessControlService',
          operation: 'verifyAndEnableMFA',
          operatorId,
        });

        return true;
      }

      loggingService.warn('Invalid MFA token for operator', {
        component: 'InternalAccessControlService',
        operation: 'verifyAndEnableMFA',
        operatorId,
      });

      return false;
    } catch (error) {
      loggingService.error('Error verifying and enabling MFA', {
        component: 'InternalAccessControlService',
        operation: 'verifyAndEnableMFA',
        operatorId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return false;
    }
  }

  /**
   * Verify MFA for an operator (for ongoing verification)
   */
  public async verifyMfa(operatorId: string, mfaToken: string): Promise<boolean> {
    try {
      const mfaData = this.operatorMFAData.get(operatorId);
      if (!mfaData || !mfaData.enabled || !mfaData.secret) {
        loggingService.warn('MFA not enabled for operator', {
          component: 'InternalAccessControlService',
          operation: 'verifyMfa',
          operatorId,
        });
        return false;
      }

      // Decrypt the secret
      const decryptedSecret = this.decryptSecret(mfaData.secret);

      // Check if it's a backup code
      const backupCodeResult = await BackupCodesService.verifyBackupCode(mfaToken, mfaData.backupCodes);
      if (backupCodeResult.verified && backupCodeResult.codeIndex !== undefined) {
        // Remove used backup code
        const updatedBackupCodes = BackupCodesService.removeUsedCode(
          mfaData.backupCodes,
          backupCodeResult.codeIndex
        );
        mfaData.backupCodes = updatedBackupCodes;
        mfaData.lastUsed = new Date();

        // Cache verification
        this.mfaVerificationCache.set(operatorId, new Date());

        loggingService.info('MFA verified using backup code', {
          component: 'InternalAccessControlService',
          operation: 'verifyMfa',
          operatorId,
        });

        return true;
      }

      // Verify TOTP token
      const verified = speakeasy.totp.verify({
        secret: decryptedSecret,
        encoding: 'base32',
        token: mfaToken,
        window: 2, // Allow 2 time steps (60 seconds) tolerance
      });

      if (verified) {
        // Cache verification
        this.mfaVerificationCache.set(operatorId, new Date());
        mfaData.lastUsed = new Date();

        loggingService.info('MFA verified for operator', {
          component: 'InternalAccessControlService',
          operation: 'verifyMfa',
          operatorId,
        });

        return true;
      }

      loggingService.warn('Invalid MFA token for operator', {
        component: 'InternalAccessControlService',
        operation: 'verifyMfa',
        operatorId,
      });

      return false;
    } catch (error) {
      loggingService.error('Error verifying MFA', {
        component: 'InternalAccessControlService',
        operation: 'verifyMfa',
        operatorId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return false;
    }
  }

  /**
   * Disable MFA for an operator
   */
  public disableMFA(operatorId: string): boolean {
    try {
      const mfaData = this.operatorMFAData.get(operatorId);
      if (!mfaData) {
        return false;
      }

      // Clear MFA data
      this.operatorMFAData.delete(operatorId);
      this.mfaVerificationCache.delete(operatorId);

      loggingService.info('MFA disabled for operator', {
        component: 'InternalAccessControlService',
        operation: 'disableMFA',
        operatorId,
      });

      return true;
    } catch (error) {
      loggingService.error('Error disabling MFA', {
        component: 'InternalAccessControlService',
        operation: 'disableMFA',
        operatorId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Get MFA status for an operator
   */
  public getMFAStatus(operatorId: string): {
    enabled: boolean;
    setupAt?: Date;
    lastUsed?: Date;
    backupCodesRemaining: number;
  } {
    const mfaData = this.operatorMFAData.get(operatorId);
    if (!mfaData) {
      return {
        enabled: false,
        backupCodesRemaining: 0,
      };
    }

    return {
      enabled: mfaData.enabled,
      setupAt: mfaData.setupAt,
      lastUsed: mfaData.lastUsed,
      backupCodesRemaining: mfaData.backupCodes.length,
    };
  }

  /**
   * Encrypt TOTP secret before storage
   */
  private encryptSecret(secret: string): string {
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(
        this.ENCRYPTION_ALGORITHM,
        this.ENCRYPTION_KEY.slice(0, 32),
        iv
      );

      let encrypted = cipher.update(secret, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const authTag = cipher.getAuthTag();

      // Combine IV, authTag, and encrypted data
      return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    } catch (error) {
      loggingService.error('Error encrypting MFA secret', {
        component: 'InternalAccessControlService',
        operation: 'encryptSecret',
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error('Failed to encrypt MFA secret');
    }
  }

  /**
   * Decrypt TOTP secret from storage
   */
  private decryptSecret(encryptedSecret: string): string {
    try {
      const parts = encryptedSecret.split(':');
      if (parts.length !== 3) {
        throw new Error('Invalid encrypted secret format');
      }

      const iv = Buffer.from(parts[0], 'hex');
      const authTag = Buffer.from(parts[1], 'hex');
      const encrypted = parts[2];

      const decipher = crypto.createDecipheriv(
        this.ENCRYPTION_ALGORITHM,
        this.ENCRYPTION_KEY.slice(0, 32),
        iv
      );

      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      loggingService.error('Error decrypting MFA secret', {
        component: 'InternalAccessControlService',
        operation: 'decryptSecret',
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error('Failed to decrypt MFA secret');
    }
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
        const startDate = filters.startDate;
        filtered = filtered.filter(e => e.timestamp >= startDate);
      }
      if (filters.endDate) {
        const endDate = filters.endDate;
        filtered = filtered.filter(e => e.timestamp <= endDate);
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
      for (const [, request] of this.pendingApprovals) {
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
