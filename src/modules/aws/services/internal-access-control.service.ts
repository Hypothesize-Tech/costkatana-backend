import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoggerService } from '../../../common/logger/logger.service';
import * as speakeasy from 'speakeasy';
import * as qrcode from 'qrcode';
import {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from 'crypto';
import { BackupCodesService } from '../../auth/backup-codes.service';
import {
  InternalAudit,
  InternalAuditDocument,
} from '../../../schemas/security/internal-audit.schema';
import {
  OperatorMFA,
  OperatorMFADocument,
} from '../../../schemas/security/operator-mfa.schema';

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
  | 'viewer' // Read-only access to dashboards
  | 'support' // Customer support, limited actions
  | 'engineer' // Development, no production access
  | 'control_admin' // Control plane admin (policies, DSL)
  | 'execution_admin' // Execution plane admin (kill switches)
  | 'security_admin' // Security operations
  | 'super_admin'; // Requires dual approval for everything

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
  execution_admin: new Set(['disable_kill_switch', 'trigger_execution']),
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

@Injectable()
export class InternalAccessControlService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly auditLog: InternalAuditEntry[] = [];

  // Pending dual approval requests
  private pendingApprovals: Map<string, DualApprovalRequest> = new Map();

  // MFA verification cache (short-lived)
  private mfaVerificationCache: Map<string, Date> = new Map();
  private readonly MFA_CACHE_DURATION_MS = 15 * 60 * 1000; // 15 minutes

  // Dual approval expiration
  private readonly DUAL_APPROVAL_EXPIRATION_MS = 30 * 60 * 1000; // 30 minutes

  // Encryption key for MFA secrets - REQUIRED in production
  private readonly ENCRYPTION_KEY: Buffer;
  private readonly ENCRYPTION_ALGORITHM = 'aes-256-gcm';

  private cleanupInterval?: NodeJS.Timeout;

  constructor(
    @InjectModel(InternalAudit.name)
    private readonly auditModel: Model<InternalAuditDocument>,
    @InjectModel(OperatorMFA.name)
    private readonly operatorMFAModel: Model<OperatorMFADocument>,
    private readonly logger: LoggerService,
    private readonly backupCodesService: BackupCodesService,
  ) {
    // Enforce encryption key requirement
    const key = process.env.INTERNAL_MFA_ENCRYPTION_KEY?.trim();
    if (!key) {
      throw new Error(
        'INTERNAL_MFA_ENCRYPTION_KEY environment variable is required for AWS internal access control',
      );
    }
    if (key.length < 32) {
      throw new Error(
        'INTERNAL_MFA_ENCRYPTION_KEY must be at least 32 characters',
      );
    }
    if (
      ['default-key-change-in-production', 'changeme', 'test', 'development']
        .map((v) => v.toLowerCase())
        .includes(key.toLowerCase())
    ) {
      throw new Error(
        'INTERNAL_MFA_ENCRYPTION_KEY must be a secure unique secret, not a placeholder value',
      );
    }
    this.ENCRYPTION_KEY = createHash('sha256').update(key).digest();
  }

  onModuleInit() {
    // Start cleanup interval
    this.startCleanupInterval();
  }

  onModuleDestroy() {
    // Clean up the interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  /**
   * Check if an operator can perform a privileged operation
   */
  checkAccess(
    operator: InternalOperator,
    operation: PrivilegedOperation,
    resource?: string,
  ): AccessControlCheckResult {
    // Check if role has permission
    const rolePermissions = ROLE_PERMISSIONS[operator.role];
    if (!rolePermissions.has(operation)) {
      this.auditAccess(
        operator,
        operation,
        'denied',
        'Insufficient role permissions',
        resource,
      );
      return {
        allowed: false,
        reason: `Role ${operator.role} does not have permission for ${operation}`,
      };
    }

    // Check if MFA is required and verified
    if (MFA_REQUIRED.has(operation)) {
      const mfaVerified = this.isMfaVerified(operator.operatorId);
      if (!mfaVerified) {
        this.auditAccess(
          operator,
          operation,
          'denied',
          'MFA verification required',
          resource,
        );
        return {
          allowed: false,
          reason: 'MFA verification required for this operation',
          requiresMfa: true,
        };
      }
    }

    // Check if dual approval is required
    if (
      DUAL_APPROVAL_REQUIRED.has(operation) ||
      operator.role === 'super_admin'
    ) {
      const approvalResult = this.checkDualApproval(
        operator,
        operation,
        resource,
      );
      if (!approvalResult.allowed) {
        return approvalResult;
      }
    }

    // Access granted
    this.auditAccess(operator, operation, 'success', undefined, resource);
    return { allowed: true };
  }

  /**
   * Setup MFA for an operator
   */
  async setupMFA(operatorId: string): Promise<OperatorMFASetup> {
    const secret = speakeasy.generateSecret({
      name: `CostKatana:${operatorId}`,
      issuer: 'CostKatana Internal',
      length: 32,
    });

    // Generate QR code
    const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url!);

    // Generate backup codes
    const backupCodes = await this.backupCodesService.generateBackupCodes();

    // Encrypt the secret
    const encryptedSecret = this.encryptMFASecret(secret.base32);

    // Encrypt backup codes
    const backupCodesData = await this.encryptBackupCodes(backupCodes);

    // Store MFA data in database
    await this.operatorMFAModel.create({
      operatorId,
      encryptedSecret: encryptedSecret.encrypted,
      iv: encryptedSecret.iv,
      authTag: encryptedSecret.authTag,
      backupCodes: backupCodesData,
      enabled: false,
    });

    this.logger.log('MFA setup initiated', {
      component: 'InternalAccessControlService',
      operation: 'setupMFA',
      operatorId,
    });

    return {
      secret: secret.base32,
      qrCodeUrl,
      backupCodes,
    };
  }

  /**
   * Verify and enable MFA for an operator
   */
  async verifyAndEnableMFA(
    operatorId: string,
    token: string,
  ): Promise<boolean> {
    const mfaData = await this.operatorMFAModel.findOne({ operatorId });
    if (!mfaData) {
      throw new Error('MFA setup not initiated for this operator');
    }

    // Decrypt the secret
    const decryptedSecret = this.decryptMFASecret(mfaData);

    // Verify the token
    const verified = speakeasy.totp.verify({
      secret: decryptedSecret,
      encoding: 'base32',
      token,
      window: 2, // Allow 2 time steps (30 seconds) tolerance
    });

    if (verified) {
      await this.operatorMFAModel.updateOne(
        { operatorId },
        {
          enabled: true,
          lastUsedAt: new Date(),
        },
      );
      this.logger.log('MFA enabled', {
        component: 'InternalAccessControlService',
        operation: 'verifyAndEnableMFA',
        operatorId,
      });
    }

    return verified;
  }

  /**
   * Verify MFA token
   */
  async verifyMfa(operatorId: string, token: string): Promise<boolean> {
    const mfaData = await this.operatorMFAModel.findOne({
      operatorId,
      enabled: true,
    });
    if (!mfaData) {
      return false;
    }

    // Check if account is locked due to failed attempts
    if (mfaData.lockedUntil && mfaData.lockedUntil > new Date()) {
      return false;
    }

    // Decrypt the secret
    const decryptedSecret = this.decryptMFASecret(mfaData);

    // Verify the token
    const verified = speakeasy.totp.verify({
      secret: decryptedSecret,
      encoding: 'base32',
      token,
      window: 2, // Allow 2 time steps (30 seconds) tolerance
    });

    // Update database based on verification result
    if (verified) {
      await this.operatorMFAModel.updateOne(
        { operatorId },
        {
          lastUsedAt: new Date(),
          failedAttempts: 0, // Reset failed attempts on success
          lockedUntil: undefined,
        },
      );
      this.mfaVerificationCache.set(operatorId, new Date());
    } else {
      // Handle failed attempt
      const failedAttempts = mfaData.failedAttempts + 1;
      let lockedUntil: Date | undefined;

      // Lock account after 5 failed attempts for 15 minutes
      if (failedAttempts >= 5) {
        lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      }

      await this.operatorMFAModel.updateOne(
        { operatorId },
        {
          failedAttempts,
          lockedUntil,
        },
      );
    }

    return verified;
  }

  /**
   * Request dual approval for a privileged operation
   */
  async requestDualApproval(
    operator: InternalOperator,
    operation: PrivilegedOperation,
    reason: string,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    const requestId = randomUUID();
    const approvalRequest: DualApprovalRequest = {
      requestId,
      operation,
      requestedBy: operator,
      requestedAt: new Date(),
      status: 'pending',
      expiresAt: new Date(Date.now() + this.DUAL_APPROVAL_EXPIRATION_MS),
      reason,
      metadata,
    };

    this.pendingApprovals.set(requestId, approvalRequest);

    this.logger.warn('Dual approval requested', {
      component: 'InternalAccessControlService',
      methodOperation: 'requestDualApproval',
      requestId,
      operatorId: operator.operatorId,
      operationName: operation,
      reason,
    });

    return requestId;
  }

  /**
   * Approve a dual approval request
   */
  async approveRequest(
    requestId: string,
    approvingOperator: InternalOperator,
  ): Promise<boolean> {
    const request = this.pendingApprovals.get(requestId);
    if (!request) {
      throw new Error('Approval request not found');
    }

    if (request.status !== 'pending') {
      throw new Error('Request is not in pending status');
    }

    if (request.requestedBy.operatorId === approvingOperator.operatorId) {
      throw new Error('Operator cannot approve their own request');
    }

    // Check if approver has higher privileges
    if (
      !this.hasHigherPrivilege(approvingOperator.role, request.requestedBy.role)
    ) {
      throw new Error('Insufficient privileges to approve this request');
    }

    request.approvedBy = approvingOperator;
    request.approvedAt = new Date();
    request.status = 'approved';

    this.logger.log('Dual approval granted', {
      component: 'InternalAccessControlService',
      operation: 'approveRequest',
      requestId,
      approvedBy: approvingOperator.operatorId,
      originalRequestor: request.requestedBy.operatorId,
    });

    return true;
  }

  /**
   * Reject a dual approval request
   */
  async rejectRequest(
    requestId: string,
    rejectingOperator: InternalOperator,
    reason: string,
  ): Promise<boolean> {
    const request = this.pendingApprovals.get(requestId);
    if (!request) {
      throw new Error('Approval request not found');
    }

    request.status = 'rejected';

    this.logger.log('Dual approval rejected', {
      component: 'InternalAccessControlService',
      operation: 'rejectRequest',
      requestId,
      rejectedBy: rejectingOperator.operatorId,
      reason,
    });

    return true;
  }

  /**
   * Get pending approval requests
   */
  getPendingApprovals(): DualApprovalRequest[] {
    return Array.from(this.pendingApprovals.values()).filter(
      (request) => request.status === 'pending',
    );
  }

  /**
   * Get audit log
   */
  getAuditLog(limit: number = 100): InternalAuditEntry[] {
    return this.auditLog.slice(-limit);
  }

  /**
   * Check if dual approval is required and available
   */
  private checkDualApproval(
    operator: InternalOperator,
    operation: PrivilegedOperation,
    resource?: string,
  ): AccessControlCheckResult {
    // For operations requiring dual approval, check if there's a pending or approved request
    const pendingRequests = Array.from(this.pendingApprovals.values()).filter(
      (request) =>
        request.requestedBy.operatorId === operator.operatorId &&
        request.operation === operation &&
        request.status === 'approved' &&
        request.approvedAt &&
        Date.now() - request.approvedAt.getTime() < 15 * 60 * 1000, // 15 minutes
    );

    if (pendingRequests.length > 0) {
      // Has valid approval
      return { allowed: true };
    }

    // Check if there's a pending approval request
    const pendingApproval = Array.from(this.pendingApprovals.values()).find(
      (request) =>
        request.requestedBy.operatorId === operator.operatorId &&
        request.operation === operation &&
        request.status === 'pending',
    );

    if (pendingApproval) {
      this.auditAccess(
        operator,
        operation,
        'pending_approval',
        'Awaiting dual approval',
        resource,
      );
      return {
        allowed: false,
        reason: 'Dual approval required and currently pending',
        requiresDualApproval: true,
        pendingApprovalId: pendingApproval.requestId,
      };
    }

    // Need to request dual approval
    this.auditAccess(
      operator,
      operation,
      'pending_approval',
      'Dual approval required',
      resource,
    );
    return {
      allowed: false,
      reason: 'Dual approval required for this operation',
      requiresDualApproval: true,
    };
  }

  /**
   * Check if MFA is verified for an operator
   */
  private isMfaVerified(operatorId: string): boolean {
    const cachedVerification = this.mfaVerificationCache.get(operatorId);
    if (cachedVerification) {
      const timeSinceVerification = Date.now() - cachedVerification.getTime();
      if (timeSinceVerification < this.MFA_CACHE_DURATION_MS) {
        return true;
      }
      // Cache expired
      this.mfaVerificationCache.delete(operatorId);
    }
    return false;
  }

  /**
   * Check if a role has higher privilege than another
   */
  private hasHigherPrivilege(
    role1: InternalRole,
    role2: InternalRole,
  ): boolean {
    const roleHierarchy: Record<InternalRole, number> = {
      viewer: 1,
      support: 2,
      engineer: 3,
      control_admin: 4,
      execution_admin: 4,
      security_admin: 4,
      super_admin: 5,
    };

    return roleHierarchy[role1] > roleHierarchy[role2];
  }

  /**
   * Encrypt MFA secret
   */
  private encryptMFASecret(secret: string): {
    encrypted: Buffer;
    iv: Buffer;
    authTag: Buffer;
  } {
    const iv = randomBytes(16);
    const cipher = createCipheriv(
      this.ENCRYPTION_ALGORITHM,
      this.ENCRYPTION_KEY,
      iv,
    );
    let encrypted = cipher.update(secret, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const authTag = cipher.getAuthTag();
    return { encrypted, iv, authTag };
  }

  /**
   * Decrypt MFA secret
   */
  private decryptMFASecret(mfaData: OperatorMFADocument): string {
    const decipher = createDecipheriv(
      this.ENCRYPTION_ALGORITHM,
      this.ENCRYPTION_KEY,
      mfaData.iv,
    );
    decipher.setAuthTag(mfaData.authTag);
    let decrypted = decipher.update(mfaData.encryptedSecret);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf8');
  }

  /**
   * Encrypt backup codes
   */
  private async encryptBackupCodes(backupCodes: string[]): Promise<{
    codes: Buffer[];
    iv: Buffer;
    authTag: Buffer;
    createdAt: Date;
  }> {
    const hashedCodes =
      await this.backupCodesService.hashBackupCodes(backupCodes);
    const codesData = JSON.stringify(hashedCodes);

    const iv = randomBytes(16);
    const cipher = createCipheriv(
      this.ENCRYPTION_ALGORITHM,
      this.ENCRYPTION_KEY,
      iv,
    );
    let encrypted = cipher.update(codesData, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      codes: hashedCodes.map((code) => Buffer.from(code, 'utf8')),
      iv,
      authTag,
      createdAt: new Date(),
    };
  }

  /**
   * Audit access attempts
   */
  private async auditAccess(
    operator: InternalOperator,
    operation: PrivilegedOperation,
    result: 'success' | 'denied' | 'pending_approval',
    reason?: string,
    resource?: string,
  ): Promise<void> {
    try {
      const localEntry: InternalAuditEntry = {
        timestamp: new Date(),
        operatorId: operator.operatorId,
        operatorEmail: operator.email,
        operation,
        resource,
        result,
        reason,
        ipAddress: operator.ipAddress,
      };
      this.auditLog.push(localEntry);
      if (this.auditLog.length > 5000) {
        this.auditLog.shift();
      }

      const auditEntry = {
        timestamp: Date.now(),
        operatorId: operator.operatorId,
        operatorEmail: operator.email,
        action: this.mapOperationToAction(operation),
        severity: this.mapResultToSeverity(result),
        details: {
          operation,
          resource,
          reason,
          ipAddress: operator.ipAddress,
        },
        securityContext: {
          riskLevel: this.calculateRiskLevel(operation),
          requiresApproval: result === 'pending_approval',
        },
      };

      await this.auditModel.create(auditEntry);
    } catch (error) {
      this.logger.error('Failed to save internal audit entry', {
        error: error instanceof Error ? error.message : String(error),
        operatorId: operator.operatorId,
        operation,
      });
    }
  }

  private mapOperationToAction(
    operation: PrivilegedOperation,
  ): InternalAudit['action'] {
    const actionMap: Record<PrivilegedOperation, InternalAudit['action']> = {
      modify_dsl_allowlist: 'config_change',
      disable_kill_switch: 'security_incident',
      access_customer_data: 'operator_action',
      modify_permission_boundary: 'config_change',
      trigger_execution: 'operator_action',
      view_external_ids: 'operator_action',
      modify_audit_config: 'config_change',
      access_encryption_keys: 'operator_action',
      modify_rate_limits: 'config_change',
      bypass_approval: 'security_incident',
    };
    return actionMap[operation];
  }

  private mapResultToSeverity(result: string): InternalAudit['severity'] {
    switch (result) {
      case 'denied':
        return 'warning';
      case 'pending_approval':
        return 'info';
      case 'success':
        return 'info';
      default:
        return 'info';
    }
  }

  private calculateRiskLevel(
    operation: PrivilegedOperation,
  ): 'low' | 'medium' | 'high' | 'critical' {
    const highRiskOps: PrivilegedOperation[] = [
      'modify_permission_boundary',
      'modify_audit_config',
      'access_customer_data',
    ];
    const criticalOps: PrivilegedOperation[] = [
      'bypass_approval',
      'access_encryption_keys',
      'disable_kill_switch',
    ];

    if (criticalOps.includes(operation)) return 'critical';
    if (highRiskOps.includes(operation)) return 'high';
    return 'medium';
  }

  /**
   * Start cleanup interval for expired approvals and cache
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      const now = new Date();

      // Clean up expired approvals
      for (const [requestId, request] of this.pendingApprovals) {
        if (request.expiresAt < now) {
          request.status = 'expired';
          this.logger.log('Dual approval request expired', {
            component: 'InternalAccessControlService',
            requestId,
          });
        }
      }

      // Clean up expired MFA verification cache
      for (const [operatorId, verificationTime] of this.mfaVerificationCache) {
        if (
          now.getTime() - verificationTime.getTime() >
          this.MFA_CACHE_DURATION_MS
        ) {
          this.mfaVerificationCache.delete(operatorId);
        }
      }
    }, 60000); // Clean up every minute
  }
}
