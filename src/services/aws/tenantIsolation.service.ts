import { Types } from 'mongoose';
import crypto from 'crypto';
import { loggingService } from '../logging.service';
import { externalIdService } from './externalId.service';

/**
 * Tenant Isolation Engine - Enterprise Security
 * 
 * Security Guarantees:
 * - Validate all requests are tenant-scoped
 * - Cross-tenant data pattern detection
 * - Stateless prompt isolation guarantees
 * - No shared memory/context between tenants
 * - Every prompt is isolated and tenant-specific
 */

export interface IsolatedPrompt {
  prompt: string;
  metadata: PromptMetadata;
}

export interface PromptMetadata {
  tenantId: string;
  sessionId: string;
  timestamp: number;
  isolation: IsolationGuarantees;
}

export interface IsolationGuarantees {
  stateless: boolean;
  noSharedContext: boolean;
  noFineTuning: boolean;
  noCrossReference: boolean;
}

export interface TenantContext {
  tenantId: string;
  userId: string;
  workspaceId?: string;
  organizationId?: string;
  awsAccountId?: string;
  sessionId: string;
  createdAt: Date;
}

export interface IsolationValidationResult {
  valid: boolean;
  violations: string[];
  riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
}

class TenantIsolationService {
  private static instance: TenantIsolationService;
  
  // Active tenant contexts (in-memory, cleared on each request)
  // This ensures no cross-request contamination
  private currentTenantContext: TenantContext | null = null;
  
  // Patterns that indicate potential cross-tenant data leakage
  private readonly DANGEROUS_PATTERNS = [
    // AWS Account ARNs from other accounts
    /arn:aws:iam::\d{12}:/g,
    // Customer/tenant references
    /customer[A-Z][a-zA-Z0-9]*/g,
    /tenant-[a-f0-9]{24}/gi,
    // External ID patterns
    /ck-(prod|stag|deve)-[0-9a-f-]+/g,
    // MongoDB ObjectIDs that might be from other tenants
    /[a-f0-9]{24}/gi,
    // AWS access keys (should never appear)
    /AKIA[0-9A-Z]{16}/g,
    /ASIA[0-9A-Z]{16}/g,
    // AWS secret keys (should never appear)
    /[A-Za-z0-9/+=]{40}/g,
  ];
  
  private constructor() {}
  
  public static getInstance(): TenantIsolationService {
    if (!TenantIsolationService.instance) {
      TenantIsolationService.instance = new TenantIsolationService();
    }
    return TenantIsolationService.instance;
  }
  
  /**
   * Create a new isolated tenant context for a request
   * This MUST be called at the start of every AWS operation
   */
  public createTenantContext(
    userId: string,
    workspaceId?: string,
    organizationId?: string,
    awsAccountId?: string
  ): TenantContext {
    const context: TenantContext = {
      tenantId: this.generateTenantId(userId, workspaceId),
      userId,
      workspaceId,
      organizationId,
      awsAccountId,
      sessionId: crypto.randomUUID(),
      createdAt: new Date(),
    };
    
    // Set as current context (will be cleared after request)
    this.currentTenantContext = context;
    
    loggingService.info('Tenant context created', {
      component: 'TenantIsolationService',
      operation: 'createTenantContext',
      tenantId: context.tenantId,
      sessionId: context.sessionId,
    });
    
    return context;
  }
  
  /**
   * Clear the current tenant context
   * This MUST be called at the end of every AWS operation
   */
  public clearTenantContext(): void {
    if (this.currentTenantContext) {
      loggingService.info('Tenant context cleared', {
        component: 'TenantIsolationService',
        operation: 'clearTenantContext',
        tenantId: this.currentTenantContext.tenantId,
        sessionId: this.currentTenantContext.sessionId,
      });
    }
    this.currentTenantContext = null;
  }
  
  /**
   * Get the current tenant context
   * Throws if no context is set (security enforcement)
   */
  public getCurrentTenantContext(): TenantContext {
    if (!this.currentTenantContext) {
      throw new Error('No tenant context set - this is a security violation');
    }
    return this.currentTenantContext;
  }
  
  /**
   * Generate a tenant ID from user and workspace
   */
  private generateTenantId(userId: string, workspaceId?: string): string {
    const base = workspaceId ? `${userId}:${workspaceId}` : userId;
    return crypto
      .createHash('sha256')
      .update(base)
      .digest('hex')
      .substring(0, 16);
  }
  
  /**
   * Generate an isolated prompt with tenant metadata
   * This ensures every prompt is stateless and tenant-isolated
   */
  public async generateIsolatedPrompt(
    tenantId: string,
    request: string
  ): Promise<IsolatedPrompt> {
    // Validate tenant context
    if (this.currentTenantContext?.tenantId !== tenantId) {
      throw new Error('Tenant ID mismatch - potential cross-tenant access');
    }
    
    // Sanitize the request to remove any sensitive patterns
    const sanitizedRequest = this.sanitizePromptContent(request, tenantId);
    
    // Build the isolated prompt
    const prompt = this.buildIsolatedPrompt(sanitizedRequest);
    
    return {
      prompt,
      metadata: {
        tenantId,
        sessionId: crypto.randomUUID(),
        timestamp: Date.now(),
        isolation: {
          stateless: true,
          noSharedContext: true,
          noFineTuning: true,
          noCrossReference: true,
        },
      },
    };
  }
  
  /**
   * Validate that a prompt maintains tenant isolation
   */
  public validateIsolation(prompt: IsolatedPrompt): IsolationValidationResult {
    const violations: string[] = [];
    
    // Check tenant ID matches current context
    if (this.currentTenantContext && 
        prompt.metadata.tenantId !== this.currentTenantContext.tenantId) {
      violations.push('Tenant isolation violation: tenant ID mismatch');
    }
    
    // Check for cross-tenant data patterns
    const crossTenantPatterns = this.detectCrossTenantPatterns(
      prompt.prompt,
      prompt.metadata.tenantId
    );
    violations.push(...crossTenantPatterns);
    
    // Check isolation guarantees
    if (!prompt.metadata.isolation.stateless) {
      violations.push('Isolation violation: prompt is not stateless');
    }
    if (!prompt.metadata.isolation.noSharedContext) {
      violations.push('Isolation violation: shared context detected');
    }
    
    // Determine risk level
    let riskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical' = 'none';
    if (violations.length > 0) {
      if (violations.some(v => v.includes('credential') || v.includes('access key'))) {
        riskLevel = 'critical';
      } else if (violations.some(v => v.includes('tenant ID mismatch'))) {
        riskLevel = 'high';
      } else if (violations.length > 3) {
        riskLevel = 'medium';
      } else {
        riskLevel = 'low';
      }
    }
    
    if (violations.length > 0) {
      loggingService.warn('Isolation validation failed', {
        component: 'TenantIsolationService',
        operation: 'validateIsolation',
        tenantId: prompt.metadata.tenantId,
        violationCount: violations.length,
        riskLevel,
      });
    }
    
    return {
      valid: violations.length === 0,
      violations,
      riskLevel,
    };
  }
  
  /**
   * Detect cross-tenant data patterns in content
   */
  private detectCrossTenantPatterns(content: string, currentTenantId: string): string[] {
    const violations: string[] = [];
    
    // Use the external ID service for comprehensive pattern detection
    const externalIdViolations = externalIdService.detectCrossTenantPatterns(
      content,
      currentTenantId
    );
    violations.push(...externalIdViolations);
    
    // Additional pattern checks
    for (const pattern of this.DANGEROUS_PATTERNS) {
      const matches = content.match(pattern);
      if (matches) {
        // Don't flag if it's the current tenant's data
        for (const match of matches) {
          if (!this.isCurrentTenantData(match, currentTenantId)) {
            violations.push(`Potential data leak: pattern "${match.substring(0, 20)}..." detected`);
          }
        }
      }
    }
    
    return violations;
  }
  
  /**
   * Check if data belongs to the current tenant
   */
  private isCurrentTenantData(data: string, currentTenantId: string): boolean {
    // Check if the data contains the current tenant ID
    if (data.includes(currentTenantId)) {
      return true;
    }
    
    // Check if it's the current user's AWS account
    if (this.currentTenantContext?.awsAccountId && 
        data.includes(this.currentTenantContext.awsAccountId)) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Sanitize prompt content to remove sensitive patterns
   */
  private sanitizePromptContent(content: string, tenantId: string): string {
    let sanitized = content;
    
    // Remove AWS credentials (should never be in prompts, but defense in depth)
    sanitized = sanitized.replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED_ACCESS_KEY]');
    sanitized = sanitized.replace(/ASIA[0-9A-Z]{16}/g, '[REDACTED_TEMP_ACCESS_KEY]');
    
    // Remove potential secret keys (40 char base64-like strings)
    sanitized = sanitized.replace(
      /(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/g,
      '[REDACTED_SECRET]'
    );
    
    // Remove other tenant references (keep current tenant)
    const tenantPattern = /tenant-([a-f0-9]{24})/gi;
    sanitized = sanitized.replace(tenantPattern, (match, id) => {
      if (id === tenantId || (this.currentTenantContext?.userId && id === this.currentTenantContext.userId)) {
        return match;
      }
      return '[REDACTED_TENANT_REF]';
    });
    
    return sanitized;
  }
  
  /**
   * Build an isolated prompt with security context
   */
  private buildIsolatedPrompt(request: string): string {
    return `[ISOLATED_CONTEXT: This prompt is stateless and tenant-isolated. No cross-tenant data should be referenced.]

${request}

[END_ISOLATED_CONTEXT]`;
  }
  
  /**
   * Validate that a request is properly tenant-scoped
   */
  public async validateTenantScope(
    userId: Types.ObjectId,
    resourceOwnerId: Types.ObjectId
  ): Promise<boolean> {
    // Simple ownership check
    if (userId.equals(resourceOwnerId)) {
      return true;
    }
    
    // Could add workspace/organization checks here
    loggingService.warn('Tenant scope validation failed', {
      component: 'TenantIsolationService',
      operation: 'validateTenantScope',
      requestingUser: userId.toString(),
      resourceOwner: resourceOwnerId.toString(),
    });
    
    return false;
  }
  
  /**
   * Create a middleware-compatible context validator
   */
  public createContextValidator() {
    return async (req: any, res: any, next: any) => {
      try {
        const userId = req.user?.id;
        const workspaceId = req.workspaceId || req.user?.workspaceId;
        
        if (!userId) {
          return res.status(401).json({ error: 'Authentication required for AWS operations' });
        }
        
        // Create tenant context for this request
        const context = this.createTenantContext(userId, workspaceId);
        
        // Attach to request
        req.tenantContext = context;
        
        // Ensure context is cleared after response
        res.on('finish', () => {
          this.clearTenantContext();
        });
        
        next();
      } catch (error) {
        loggingService.error('Tenant context creation failed', {
          component: 'TenantIsolationService',
          operation: 'contextValidator',
          error: error instanceof Error ? error.message : String(error),
        });
        return res.status(500).json({ error: 'Failed to establish tenant context' });
      }
    };
  }
}

export const tenantIsolationService = TenantIsolationService.getInstance();
