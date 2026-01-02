import crypto from 'crypto';
import * as yaml from 'js-yaml';
import { loggingService } from '../logging.service';
import {
  ActionDefinition,
  ParsedAction,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  DSLVersion,
  ALLOWED_ACTIONS,
  DSL_VERSION_HISTORY,
  RiskLevel,
} from '../../types/awsDsl.types';

/**
 * DSL Parser & Validator - Deterministic Action Processing
 * 
 * Security Guarantees:
 * - Parse YAML DSL definitions
 * - Validate against JSON schema
 * - Check action against allowlist
 * - Generate hash and signature for audit
 * - Version management for DSL contracts
 * - DSL versions are IMMUTABLE once released
 */

// Set of allowed action names (for fast lookup)
const ALLOWED_ACTION_SET = new Set(ALLOWED_ACTIONS.map(a => a.action));

// Current DSL version
const CURRENT_DSL_VERSION: DSLVersion = '1.0';

class DSLParserService {
  private static instance: DSLParserService;
  
  private constructor() {}
  
  public static getInstance(): DSLParserService {
    if (!DSLParserService.instance) {
      DSLParserService.instance = new DSLParserService();
    }
    return DSLParserService.instance;
  }
  
  /**
   * Parse a DSL string (YAML format) into a validated action
   */
  public parse(input: string): ParsedAction {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    
    let dsl: ActionDefinition;
    
    try {
      // Parse YAML
      const parsed = yaml.load(input) as any;
      
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid DSL: must be a valid YAML object');
      }
      
      // Validate and transform to ActionDefinition
      dsl = this.transformToDSL(parsed, errors, warnings);
      
    } catch (error) {
      errors.push({
        field: 'root',
        message: error instanceof Error ? error.message : 'Failed to parse DSL',
        code: 'PARSE_ERROR',
      });
      
      // Return with errors
      return {
        dsl: {} as ActionDefinition,
        hash: '',
        dslVersion: CURRENT_DSL_VERSION,
        parsedAt: new Date(),
        validation: {
          valid: false,
          errors,
          warnings,
        },
      };
    }
    
    // Validate the DSL
    this.validateDSL(dsl, errors, warnings);
    
    // Check action is allowed
    if (!ALLOWED_ACTION_SET.has(dsl.action)) {
      errors.push({
        field: 'action',
        message: `Action '${dsl.action}' is not in the allowed actions list`,
        code: 'ACTION_NOT_ALLOWED',
      });
    }
    
    // Generate hash for audit
    const hash = this.hashDSL(dsl);
    
    // Generate signature (optional, for non-repudiation)
    const signature = this.signDSL(dsl);
    
    const result: ParsedAction = {
      dsl,
      hash,
      signature,
      dslVersion: dsl.version || CURRENT_DSL_VERSION,
      parsedAt: new Date(),
      validation: {
        valid: errors.length === 0,
        errors,
        warnings,
      },
    };
    
    loggingService.info('DSL parsed', {
      component: 'DSLParserService',
      operation: 'parse',
      action: dsl.action,
      valid: result.validation.valid,
      errorCount: errors.length,
      warningCount: warnings.length,
      hash: hash.substring(0, 16),
    });
    
    return result;
  }
  
  /**
   * Parse from a JavaScript object (for programmatic creation)
   */
  public parseObject(input: Partial<ActionDefinition>): ParsedAction {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    
    // Transform to full DSL
    const dsl = this.transformToDSL(input, errors, warnings);
    
    // Validate
    this.validateDSL(dsl, errors, warnings);
    
    // Check action is allowed
    if (!ALLOWED_ACTION_SET.has(dsl.action)) {
      errors.push({
        field: 'action',
        message: `Action '${dsl.action}' is not in the allowed actions list`,
        code: 'ACTION_NOT_ALLOWED',
      });
    }
    
    const hash = this.hashDSL(dsl);
    const signature = this.signDSL(dsl);
    
    return {
      dsl,
      hash,
      signature,
      dslVersion: dsl.version || CURRENT_DSL_VERSION,
      parsedAt: new Date(),
      validation: {
        valid: errors.length === 0,
        errors,
        warnings,
      },
    };
  }
  
  /**
   * Transform raw input to ActionDefinition with defaults
   */
  private transformToDSL(
    input: any,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): ActionDefinition {
    // Required fields
    if (!input.action) {
      errors.push({
        field: 'action',
        message: 'Action is required',
        code: 'REQUIRED_FIELD',
      });
    }
    
    // Get template for this action
    const template = ALLOWED_ACTIONS.find(a => a.action === input.action);
    
    return {
      action: input.action || '',
      version: input.version || CURRENT_DSL_VERSION,
      
      metadata: {
        name: input.metadata?.name || template?.name || input.action || '',
        description: input.metadata?.description || template?.description || '',
        category: input.metadata?.category || template?.category || 'read',
        risk: input.metadata?.risk || template?.risk || 'medium',
        reversible: input.metadata?.reversible ?? template?.template?.metadata?.reversible ?? true,
        costImpact: input.metadata?.costImpact || template?.template?.metadata?.costImpact || 'unknown',
        estimatedDuration: input.metadata?.estimatedDuration,
        documentation: input.metadata?.documentation,
        tags: input.metadata?.tags || [],
      },
      
      selector: {
        service: input.selector?.service || this.extractService(input.action),
        resourceType: input.selector?.resourceType || this.extractResourceType(input.action),
        filters: input.selector?.filters || [],
        regions: input.selector?.regions,
        accounts: input.selector?.accounts,
      },
      
      constraints: {
        maxResources: input.constraints?.maxResources || 5,
        regions: input.constraints?.regions || ['us-east-1'],
        timeWindow: input.constraints?.timeWindow,
        requireApproval: input.constraints?.requireApproval ?? template?.requiresApproval ?? true,
        approvalLevel: input.constraints?.approvalLevel || 'user',
        maxCostImpact: input.constraints?.maxCostImpact,
        simulationRequired: input.constraints?.simulationRequired,
        simulationPeriodDays: input.constraints?.simulationPeriodDays,
        dependsOn: input.constraints?.dependsOn,
        excludeResources: input.constraints?.excludeResources,
        excludeTags: input.constraints?.excludeTags,
      },
      
      execution: {
        preChecks: input.execution?.preChecks || [
          { type: 'verify_permissions', failAction: 'abort' },
        ],
        action: input.execution?.action || {
          operation: this.getDefaultOperation(input.action),
          parameters: input.execution?.action?.parameters || {},
        },
        postChecks: input.execution?.postChecks || [
          { type: 'verify_state', timeout: 60 },
        ],
        rollback: input.execution?.rollback,
        retry: input.execution?.retry || {
          maxAttempts: 3,
          backoffType: 'exponential',
          initialDelayMs: 1000,
          maxDelayMs: 30000,
        },
      },
      
      audit: {
        logLevel: input.audit?.logLevel || 'standard',
        notify: input.audit?.notify || ['owner'],
        complianceTags: input.audit?.complianceTags || ['cost_optimization'],
        retentionDays: input.audit?.retentionDays || 90,
      },
    };
  }
  
  /**
   * Validate the DSL structure and values
   */
  private validateDSL(
    dsl: ActionDefinition,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    // Validate version
    const versionInfo = DSL_VERSION_HISTORY.find(v => v.version === dsl.version);
    if (!versionInfo) {
      errors.push({
        field: 'version',
        message: `Unknown DSL version '${dsl.version}'`,
        code: 'INVALID_VERSION',
      });
    } else if (versionInfo.deprecated) {
      warnings.push({
        field: 'version',
        message: `DSL version '${dsl.version}' is deprecated`,
        suggestion: 'Consider upgrading to the latest version',
      });
    }
    
    // Validate metadata
    if (!dsl.metadata.name) {
      errors.push({
        field: 'metadata.name',
        message: 'Metadata name is required',
        code: 'REQUIRED_FIELD',
      });
    }
    
    // Validate risk level
    const validRiskLevels: RiskLevel[] = ['low', 'medium', 'high', 'critical'];
    if (!validRiskLevels.includes(dsl.metadata.risk)) {
      errors.push({
        field: 'metadata.risk',
        message: `Invalid risk level '${dsl.metadata.risk}'`,
        code: 'INVALID_VALUE',
      });
    }
    
    // Validate selector
    if (!dsl.selector.service) {
      errors.push({
        field: 'selector.service',
        message: 'Selector service is required',
        code: 'REQUIRED_FIELD',
      });
    }
    
    // Validate constraints
    if (dsl.constraints.maxResources < 1) {
      errors.push({
        field: 'constraints.maxResources',
        message: 'maxResources must be at least 1',
        code: 'INVALID_VALUE',
      });
    }
    
    if (dsl.constraints.maxResources > 100) {
      warnings.push({
        field: 'constraints.maxResources',
        message: 'maxResources is very high',
        suggestion: 'Consider reducing to avoid unintended large-scale changes',
      });
    }
    
    if (dsl.constraints.regions.length === 0) {
      errors.push({
        field: 'constraints.regions',
        message: 'At least one region must be specified',
        code: 'REQUIRED_FIELD',
      });
    }
    
    // Validate execution
    if (!dsl.execution.action.operation) {
      errors.push({
        field: 'execution.action.operation',
        message: 'Execution operation is required',
        code: 'REQUIRED_FIELD',
      });
    }
    
    // Validate high-risk actions have approval
    if (dsl.metadata.risk === 'high' || dsl.metadata.risk === 'critical') {
      if (!dsl.constraints.requireApproval) {
        warnings.push({
          field: 'constraints.requireApproval',
          message: 'High-risk action without approval requirement',
          suggestion: 'Enable requireApproval for high-risk actions',
        });
      }
    }
    
    // Validate rollback for non-reversible actions
    if (!dsl.metadata.reversible && !dsl.execution.rollback) {
      warnings.push({
        field: 'execution.rollback',
        message: 'Non-reversible action without rollback configuration',
        suggestion: 'Consider adding a rollback plan',
      });
    }
  }
  
  /**
   * Generate SHA-256 hash of the DSL for audit
   */
  public hashDSL(dsl: ActionDefinition): string {
    const canonicalJson = JSON.stringify(dsl, Object.keys(dsl).sort());
    return crypto
      .createHash('sha256')
      .update(canonicalJson)
      .digest('hex');
  }
  
  /**
   * Sign the DSL for non-repudiation (optional)
   */
  private signDSL(dsl: ActionDefinition): string {
    // In production, this would use a proper signing key
    const signingKey = process.env.DSL_SIGNING_KEY || 'costkatana-dsl-signing-key';
    const canonicalJson = JSON.stringify(dsl, Object.keys(dsl).sort());
    
    return crypto
      .createHmac('sha256', signingKey)
      .update(canonicalJson)
      .digest('hex');
  }
  
  /**
   * Verify a DSL hash matches the content
   */
  public verifyHash(dsl: ActionDefinition, expectedHash: string): boolean {
    const actualHash = this.hashDSL(dsl);
    return actualHash === expectedHash;
  }
  
  /**
   * Extract service from action name (e.g., 'ec2.stop' -> 'ec2')
   */
  private extractService(action: string): string {
    const parts = action?.split('.') || [];
    return parts[0] || '';
  }
  
  /**
   * Extract resource type from action name
   */
  private extractResourceType(action: string): string {
    const serviceResourceMap: Record<string, string> = {
      'ec2.stop': 'instance',
      'ec2.start': 'instance',
      'ec2.resize': 'instance',
      's3.lifecycle': 'bucket',
      's3.intelligent_tiering': 'bucket',
      'rds.stop': 'db-instance',
      'rds.start': 'db-instance',
      'rds.snapshot': 'db-instance',
      'rds.resize': 'db-instance',
      'lambda.update_memory': 'function',
      'lambda.update_timeout': 'function',
    };
    
    return serviceResourceMap[action] || 'resource';
  }
  
  /**
   * Get default AWS operation for an action
   */
  private getDefaultOperation(action: string): string {
    const operationMap: Record<string, string> = {
      'ec2.stop': 'StopInstances',
      'ec2.start': 'StartInstances',
      'ec2.resize': 'ModifyInstanceAttribute',
      's3.lifecycle': 'PutBucketLifecycleConfiguration',
      's3.intelligent_tiering': 'PutBucketIntelligentTieringConfiguration',
      'rds.stop': 'StopDBInstance',
      'rds.start': 'StartDBInstance',
      'rds.snapshot': 'CreateDBSnapshot',
      'rds.resize': 'ModifyDBInstance',
      'lambda.update_memory': 'UpdateFunctionConfiguration',
      'lambda.update_timeout': 'UpdateFunctionConfiguration',
    };
    
    return operationMap[action] || '';
  }
  
  /**
   * Get allowed actions list
   */
  public getAllowedActions(): typeof ALLOWED_ACTIONS {
    return ALLOWED_ACTIONS;
  }
  
  /**
   * Check if an action is allowed
   */
  public isActionAllowed(action: string): boolean {
    return ALLOWED_ACTION_SET.has(action);
  }
  
  /**
   * Get DSL version history
   */
  public getVersionHistory(): typeof DSL_VERSION_HISTORY {
    return DSL_VERSION_HISTORY;
  }
  
  /**
   * Get current DSL version
   */
  public getCurrentVersion(): DSLVersion {
    return CURRENT_DSL_VERSION;
  }
  
  /**
   * Generate a DSL template for an action
   */
  public generateTemplate(action: string): string {
    const template = ALLOWED_ACTIONS.find(a => a.action === action);
    
    if (!template) {
      throw new Error(`Unknown action: ${action}`);
    }
    
    const dsl = {
      action: template.action,
      version: CURRENT_DSL_VERSION,
      metadata: {
        ...template.template?.metadata,
        name: template.name,
        description: template.description,
      },
      selector: {
        service: this.extractService(action),
        resourceType: this.extractResourceType(action),
        filters: [
          { field: 'state', operator: 'equals', value: 'running' },
        ],
      },
      constraints: {
        maxResources: 5,
        regions: ['us-east-1'],
        requireApproval: template.requiresApproval,
      },
      execution: {
        preChecks: [
          { type: 'verify_permissions', failAction: 'abort' },
        ],
        action: {
          operation: this.getDefaultOperation(action),
          parameters: {},
        },
        postChecks: [
          { type: 'verify_state', timeout: 60 },
        ],
      },
      audit: {
        logLevel: 'standard',
        notify: ['owner'],
        complianceTags: ['cost_optimization'],
      },
    };
    
    return yaml.dump(dsl, { lineWidth: 120 });
  }
}

export const dslParserService = DSLParserService.getInstance();
