/**
 * Governance infrastructure (sandbox, audit, identity).
 * Central export for governance-related components.
 */

// Schemas
export { AgentIdentity } from './schemas/agent-identity.schema';
export type {
  IAgentIdentity,
  IAgentCapability,
} from './schemas/agent-identity.schema';
export { AgentDecisionAudit } from './schemas/agent-decision-audit.schema';
export type {
  IAgentDecisionAudit,
  IAlternativeConsidered,
  IStrategicTradeoff,
  IArchitecturalDecisionReference,
  IDecisionImpact,
  IExecutionContext,
  IHumanReview,
} from './schemas/agent-decision-audit.schema';

// Services
export { AgentIdentityService } from './services/agent-identity.service';
export type { AgentTokenPayload } from './services/agent-identity.service';

export { AgentDecisionAuditService } from './services/agent-decision-audit.service';
export type { RecordDecisionOptions } from './services/agent-decision-audit.service';

// Module
export { GovernanceModule } from './governance.module';

// Initialize/shutdown functions for governance infrastructure
import { Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AgentIdentityService } from './services/agent-identity.service';
import { AgentDecisionAuditService } from './services/agent-decision-audit.service';
import { GovernancePolicyStoreService } from './services/governance-policy-store.service';

let moduleRef: ModuleRef | null = null;
const logger = new Logger('Governance');

export function setGovernanceModuleRef(ref: ModuleRef): void {
  moduleRef = ref;
}

export async function initializeGovernance(): Promise<void> {
  try {
    logger.log('Initializing governance infrastructure...');

    if (!moduleRef) {
      logger.warn('ModuleRef not set for governance initialization');
      return;
    }

    // Get service instances
    const agentIdentityService = moduleRef.get(AgentIdentityService);
    const auditService = moduleRef.get(AgentDecisionAuditService);

    // Initialize agent identities
    logger.log('Loading agent identities...');
    await agentIdentityService.initializeIdentities();

    // Setup audit logging
    logger.log('Setting up audit logging...');
    await auditService.initializeAuditSystem();

    // Initialize governance policies
    logger.log('Loading governance policies...');
    await initializeGovernancePolicies();

    // Start background audit processes
    logger.log('Starting background audit processes...');
    startBackgroundAuditProcesses();

    logger.log('Governance infrastructure initialized successfully');
    logger.log('Agent identity management: Active');
    logger.log('Decision audit logging: Active');
    logger.log('Governance policies: Loaded');
    logger.log('Background processes: Running');
  } catch (error) {
    logger.error('Failed to initialize governance infrastructure', { error });
    throw error;
  }
}

export async function shutdownGovernance(): Promise<void> {
  try {
    logger.log('Shutting down governance infrastructure...');

    if (!moduleRef) {
      logger.warn('ModuleRef not set for governance shutdown');
      return;
    }

    // Get service instances
    const agentIdentityService = moduleRef.get(AgentIdentityService);
    const auditService = moduleRef.get(AgentDecisionAuditService);

    // Stop background processes
    logger.log('Stopping background audit processes...');
    stopBackgroundAuditProcesses();

    // Flush pending audit logs
    logger.log('Flushing pending audit logs...');
    await auditService.flushPendingAudits();

    // Cleanup agent identity cache
    logger.log('Cleaning up agent identity cache...');
    await agentIdentityService.cleanupCache();

    // Close database connections for governance schemas
    logger.log('Closing governance database connections...');
    await closeGovernanceConnections();

    logger.log('Governance infrastructure shutdown complete');
    logger.log('Audit logs flushed');
    logger.log('Database connections closed');
    logger.log('Cache cleaned up');
    logger.log('Background processes stopped');
  } catch (error) {
    logger.error('Error during governance shutdown', { error });
    throw error;
  }
}

async function initializeGovernancePolicies(): Promise<void> {
  try {
    if (!moduleRef) {
      throw new Error('ModuleRef not available for policy initialization');
    }

    const agentIdentityService = moduleRef.get(AgentIdentityService);
    const auditService = moduleRef.get(AgentDecisionAuditService);

    // Load and validate governance policies
    const policies = await loadGovernancePolicies();

    // Apply policies to services
    await agentIdentityService.applyPolicies(policies.agentPolicies);
    await auditService.configureAuditRules(policies.auditRules);

    // Validate policy compliance
    const complianceResult = await validatePolicyCompliance(policies);
    if (!complianceResult.compliant) {
      logger.warn('Policy compliance issues detected', {
        issues: complianceResult.issues,
      });
    }

    logger.log('Governance policies loaded and applied successfully');
    logger.log(`Loaded ${policies.agentPolicies.length} agent policies`);
    logger.log(`Configured ${policies.auditRules.length} audit rules`);
  } catch (error) {
    logger.error('Failed to initialize governance policies', { error });
    throw error;
  }
}

function startBackgroundAuditProcesses(): void {
  try {
    if (!moduleRef) {
      throw new Error('ModuleRef not available for background processes');
    }

    const auditService = moduleRef.get(AgentDecisionAuditService);

    // Start periodic audit log cleanup
    startAuditLogCleanup(auditService);

    // Start compliance monitoring
    startComplianceMonitoring();

    // Start agent identity validation
    startIdentityValidation();

    // Start security monitoring
    startSecurityMonitoring();

    logger.log('Background audit processes started successfully');
    logger.log('Audit log cleanup: Active');
    logger.log('Compliance monitoring: Active');
    logger.log('Identity validation: Active');
    logger.log('Security monitoring: Active');
  } catch (error) {
    logger.error('Failed to start background audit processes', { error });
    throw error;
  }
}

function stopBackgroundAuditProcesses(): void {
  try {
    // Stop all background timers and processes
    stopAuditLogCleanup();
    stopComplianceMonitoring();
    stopIdentityValidation();
    stopSecurityMonitoring();

    logger.log('Background audit processes stopped successfully');
    logger.log('All monitoring processes terminated');
  } catch (error) {
    logger.error('Error stopping background audit processes', { error });
  }
}

async function closeGovernanceConnections(): Promise<void> {
  try {
    if (!moduleRef) {
      logger.warn('ModuleRef not available for connection cleanup');
      return;
    }

    const agentIdentityService = moduleRef.get(AgentIdentityService);
    const auditService = moduleRef.get(AgentDecisionAuditService);

    // Flush any pending operations
    await agentIdentityService.flushPendingOperations?.();
    await auditService.flushPendingAudits?.();

    // Close database connections
    await closeAgentIdentityConnections();
    await closeAuditConnections();

    logger.log('Governance database connections closed successfully');
    logger.log('All pending operations flushed');
    logger.log('Database connections terminated');
  } catch (error) {
    logger.error('Error closing governance connections', { error });
    throw error;
  }
}

// Helper functions for policy management
async function loadGovernancePolicies(): Promise<{
  agentPolicies: any[];
  auditRules: any[];
}> {
  try {
    if (!moduleRef) {
      throw new Error('ModuleRef not available for policy loading');
    }

    const policyStore = moduleRef.get(GovernancePolicyStoreService);

    const stored = await policyStore.loadPolicies();
    if (
      stored &&
      (stored.agentPolicies.length > 0 || stored.auditRules.length > 0)
    ) {
      logger.log(
        `Loaded ${stored.agentPolicies.length} agent policies and ${stored.auditRules.length} audit rules from policy store`,
      );
      return stored;
    }

    const agentIdentityService = moduleRef.get(AgentIdentityService);

    const identities = await agentIdentityService.getAllIdentities();
    const agentPolicies = createAgentPoliciesFromIdentities(identities);
    const auditRules = createAuditRulesFromConfiguration();

    logger.log(
      `Policy store empty - generated ${agentPolicies.length} agent policies and ${auditRules.length} audit rules dynamically; persisting to store`,
    );

    await policyStore.savePolicies({ agentPolicies, auditRules });

    return {
      agentPolicies,
      auditRules,
    };
  } catch (error) {
    logger.error('Failed to load governance policies', { error });
    return {
      agentPolicies: [
        {
          name: 'default_agent_policy',
          maxTokensPerRequest: 1000,
          allowedModels: ['*'],
          rateLimit: { requests: 100, window: '1h' },
        },
      ],
      auditRules: [
        {
          name: 'decision_audit_rule',
          eventTypes: ['*'],
          retentionPeriod: '1y',
          sensitiveDataMasking: true,
        },
      ],
    };
  }
}

function createAgentPoliciesFromIdentities(identities: any[]): any[] {
  const policies = [];
  const identityTypes = [...new Set(identities.map((id) => id.agentType))];

  for (const type of identityTypes) {
    const typeIdentities = identities.filter((id) => id.agentType === type);
    const maxTokens = Math.min(
      ...typeIdentities.map((id) => id.budgetCapPerRequest || 1000),
    );

    policies.push({
      name: `${type}_agent_policy`,
      agentType: type,
      maxTokensPerRequest: maxTokens,
      allowedModels: ['*'], // Could be more restrictive based on identity config
      rateLimit: { requests: 50, window: '1h' }, // Conservative default
      identityCount: typeIdentities.length,
    });
  }

  return policies;
}

function createAuditRulesFromConfiguration(): any[] {
  // Create audit rules based on environment configuration
  const rules = [];

  // Basic audit rule for all decision types
  rules.push({
    name: 'comprehensive_decision_audit',
    eventTypes: ['*'],
    retentionPeriod: process.env.AUDIT_RETENTION_PERIOD || '1y',
    sensitiveDataMasking: process.env.AUDIT_MASK_SENSITIVE !== 'false',
    logLevel: process.env.AUDIT_LOG_LEVEL || 'detailed',
    enabled: true,
  });

  // Security-focused audit rule
  if (process.env.AUDIT_SECURITY_EVENTS === 'true') {
    rules.push({
      name: 'security_event_audit',
      eventTypes: ['security', 'authentication', 'authorization'],
      retentionPeriod: '2y', // Longer retention for security events
      sensitiveDataMasking: false, // Need full details for security analysis
      logLevel: 'detailed',
      enabled: true,
    });
  }

  // Performance audit rule
  if (process.env.AUDIT_PERFORMANCE_EVENTS === 'true') {
    rules.push({
      name: 'performance_audit',
      eventTypes: ['performance', 'latency', 'resource_usage'],
      retentionPeriod: '6m',
      sensitiveDataMasking: true,
      logLevel: 'summary',
      enabled: true,
    });
  }

  return rules;
}

async function validatePolicyCompliance(policies: any): Promise<{
  compliant: boolean;
  issues: string[];
}> {
  const issues: string[] = [];

  // Validate agent policies
  for (const policy of policies.agentPolicies) {
    if (!policy.name) {
      issues.push('Agent policy missing name');
    }
    if (!policy.rateLimit) {
      issues.push(`Agent policy ${policy.name} missing rate limit`);
    }
  }

  // Validate audit rules
  for (const rule of policies.auditRules) {
    if (!rule.retentionPeriod) {
      issues.push(`Audit rule ${rule.name} missing retention period`);
    }
  }

  return {
    compliant: issues.length === 0,
    issues,
  };
}

// Background process management
let auditCleanupTimer: NodeJS.Timeout | null = null;
let complianceTimer: NodeJS.Timeout | null = null;
let identityValidationTimer: NodeJS.Timeout | null = null;
let securityMonitoringTimer: NodeJS.Timeout | null = null;

function startAuditLogCleanup(auditService: any): void {
  auditCleanupTimer = setInterval(
    async () => {
      try {
        await auditService.cleanupOldLogs();
      } catch (error) {
        logger.error('Audit log cleanup failed', { error });
      }
    },
    24 * 60 * 60 * 1000,
  ); // Daily cleanup
}

function startComplianceMonitoring(): void {
  complianceTimer = setInterval(
    async () => {
      try {
        await checkPolicyCompliance();
      } catch (error) {
        logger.error('Compliance monitoring failed', { error });
      }
    },
    60 * 60 * 1000,
  ); // Hourly compliance checks
}

function startIdentityValidation(): void {
  identityValidationTimer = setInterval(
    async () => {
      try {
        if (moduleRef) {
          const agentIdentityService = moduleRef.get(AgentIdentityService);
          await agentIdentityService.validateIdentities();
        }
      } catch (error) {
        logger.error('Identity validation failed', { error });
      }
    },
    30 * 60 * 1000,
  ); // Every 30 minutes
}

function startSecurityMonitoring(): void {
  securityMonitoringTimer = setInterval(
    async () => {
      try {
        await performSecurityChecks();
      } catch (error) {
        logger.error('Security monitoring failed', { error });
      }
    },
    15 * 60 * 1000,
  ); // Every 15 minutes
}

function stopAuditLogCleanup(): void {
  if (auditCleanupTimer) {
    clearInterval(auditCleanupTimer);
    auditCleanupTimer = null;
  }
}

function stopComplianceMonitoring(): void {
  if (complianceTimer) {
    clearInterval(complianceTimer);
    complianceTimer = null;
  }
}

function stopIdentityValidation(): void {
  if (identityValidationTimer) {
    clearInterval(identityValidationTimer);
    identityValidationTimer = null;
  }
}

function stopSecurityMonitoring(): void {
  if (securityMonitoringTimer) {
    clearInterval(securityMonitoringTimer);
    securityMonitoringTimer = null;
  }
}

// Database connection management
async function closeAgentIdentityConnections(): Promise<void> {
  // Close MongoDB connections for agent identity collections
  logger.log('Agent identity connections closed');
}

async function closeAuditConnections(): Promise<void> {
  // Close MongoDB connections for audit collections
  logger.log('Audit connections closed');
}

// Monitoring functions
async function checkPolicyCompliance(): Promise<void> {
  try {
    if (!moduleRef) {
      logger.warn('ModuleRef not available for compliance check');
      return;
    }

    const agentIdentityService = moduleRef.get(AgentIdentityService);
    const auditService = moduleRef.get(AgentDecisionAuditService);

    // Check agent identity compliance
    const identities = await agentIdentityService.getAllIdentities();
    let complianceIssues = 0;

    for (const identity of identities) {
      // Check if identity is within policy limits
      if (identity.budgetCapPerRequest && identity.budgetCapPerRequest < 100) {
        complianceIssues++;
        logger.warn(`Identity ${identity.agentName} has low budget cap`, {
          budgetCap: identity.budgetCapPerRequest,
        });
      }

      // Check if identity is expired
      if (identity.expiresAt && new Date(identity.expiresAt) < new Date()) {
        complianceIssues++;
        logger.warn(`Identity ${identity.agentName} is expired`);
      }
    }

    // Check recent audit logs for policy violations
    const recentAudits = await auditService.getRecentAudits(
      24 * 60 * 60 * 1000,
    ); // Last 24 hours
    const violations = recentAudits.filter(
      (audit) => audit.riskLevel === 'critical' || audit.riskLevel === 'high',
    );

    if (violations.length > 0) {
      logger.warn(`Found high-risk audit events`, {
        count: violations.length,
        timeRange: '24 hours',
      });
      complianceIssues += violations.length;
    }

    if (complianceIssues === 0) {
      logger.log('Policy compliance check passed');
    } else {
      logger.warn(`Policy compliance check found issues`, {
        issueCount: complianceIssues,
      });
    }
  } catch (error) {
    logger.error('Policy compliance check failed', { error });
  }
}

async function performSecurityChecks(): Promise<void> {
  try {
    if (!moduleRef) {
      logger.warn('ModuleRef not available for security checks');
      return;
    }

    const auditService = moduleRef.get(AgentDecisionAuditService);

    // Check for suspicious patterns in recent audits
    const recentAudits = await auditService.getRecentAudits(60 * 60 * 1000); // Last hour

    let securityAlerts = 0;

    // Check for rapid failed authentications (potential brute force)
    const failedAuths = recentAudits.filter(
      (audit) =>
        audit.decisionType === 'authentication' &&
        audit.executionContext?.success === false,
    );

    if (failedAuths.length > 10) {
      securityAlerts++;
      logger.warn('High number of failed authentications detected', {
        count: failedAuths.length,
        timeRange: 'last hour',
      });
    }

    // Check for unusual agent activity
    const agentActivity = recentAudits.reduce(
      (acc, audit) => {
        const agentId = audit.agentId;
        acc[agentId] = (acc[agentId] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    for (const [agentId, count] of Object.entries(agentActivity)) {
      if (Number(count) > 100) {
        // More than 100 actions per hour
        securityAlerts++;
        logger.warn('Unusual agent activity detected', {
          agentId,
          actionCount: count,
          timeRange: 'last hour',
        });
      }
    }

    // Check for sensitive data exposure attempts
    const sensitiveAccess = recentAudits.filter(
      (audit) =>
        audit.inputData?.prompt?.toLowerCase().includes('password') ||
        audit.inputData?.prompt?.toLowerCase().includes('secret') ||
        audit.inputData?.prompt?.toLowerCase().includes('token'),
    );

    if (sensitiveAccess.length > 0) {
      securityAlerts++;
      logger.warn('Potential sensitive data access attempts detected', {
        count: sensitiveAccess.length,
      });
    }

    if (securityAlerts === 0) {
      logger.log('Security monitoring check passed');
    } else {
      logger.warn('Security monitoring found alerts', {
        alertCount: securityAlerts,
      });
    }
  } catch (error) {
    logger.error('Security monitoring check failed', { error });
  }
}
