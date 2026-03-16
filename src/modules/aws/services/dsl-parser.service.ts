import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../../common/logger/logger.service';
import * as yaml from 'js-yaml';
import { createHash, createHmac } from 'crypto';
import {
  ActionDefinition,
  ParsedAction,
  ValidationError,
  ValidationWarning,
  DSLVersion,
  ALLOWED_ACTIONS,
  DSL_VERSION_HISTORY,
} from '../types/aws-dsl.types';
import type {
  ActionMetadata,
  ResourceSelector,
  ActionConstraints,
  ExecutionConfig,
  AuditConfig,
} from '../types/aws-dsl.types';

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
const ALLOWED_ACTION_SET = new Set(ALLOWED_ACTIONS.map((a) => a.action));

// Current DSL version
const CURRENT_DSL_VERSION: DSLVersion = '1.0';

const DEFAULT_METADATA: ActionMetadata = {
  name: '',
  description: '',
  category: 'read',
  risk: 'medium',
  reversible: false,
  costImpact: 'neutral',
};

const DEFAULT_SELECTOR: ResourceSelector = {
  service: 'ec2',
  resourceType: '',
  filters: [],
};

const DEFAULT_CONSTRAINTS: ActionConstraints = {
  maxResources: 100,
  regions: [],
  requireApproval: true,
};

const DEFAULT_EXECUTION: ExecutionConfig = {
  preChecks: [],
  action: { operation: '', parameters: {} },
  postChecks: [],
};

const DEFAULT_AUDIT: AuditConfig = {
  logLevel: 'standard',
  notify: [],
  complianceTags: [],
};

@Injectable()
export class DslParserService {
  constructor(private readonly logger: LoggerService) {}

  /**
   * Parse a DSL string (YAML format) into a validated action
   */
  parse(input: string): ParsedAction {
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
      dsl = this.transformToDSL(parsed, errors);
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

    this.logger.log('DSL parsed', {
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
  parseObject(input: Partial<ActionDefinition>): ParsedAction {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Transform to full DSL
    const dsl = this.transformToDSL(input, errors);

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
    const template = ALLOWED_ACTIONS.find((a) => a.action === input.action);

    return {
      action: input.action || '',
      version: input.version || CURRENT_DSL_VERSION,

      metadata: {
        name: input.metadata?.name || template?.name || input.action || '',
        description: input.metadata?.description || template?.description || '',
        category: input.metadata?.category || template?.category || 'read',
        risk: input.metadata?.risk || template?.risk || 'medium',
        reversible:
          input.metadata?.reversible ??
          template?.template?.metadata?.reversible ??
          true,
        costImpact:
          input.metadata?.costImpact ||
          template?.template?.metadata?.costImpact ||
          'unknown',
        estimatedDuration: input.metadata?.estimatedDuration,
        documentation: input.metadata?.documentation,
        tags: input.metadata?.tags,
      },

      selector: {
        service:
          input.selector?.service ||
          template?.template?.selector?.service ||
          '',
        resourceType:
          input.selector?.resourceType ||
          template?.template?.selector?.resourceType ||
          '',
        filters:
          input.selector?.filters ||
          template?.template?.selector?.filters ||
          [],
        regions: input.selector?.regions,
        accounts: input.selector?.accounts,
      },

      constraints: {
        maxResources:
          input.constraints?.maxResources ||
          template?.template?.constraints?.maxResources ||
          10,
        regions:
          input.constraints?.regions ||
          template?.template?.constraints?.regions ||
          [],
        timeWindow: input.constraints?.timeWindow,
        requireApproval:
          input.constraints?.requireApproval ??
          template?.requiresApproval ??
          false,
        approvalLevel: input.constraints?.approvalLevel,
        maxCostImpact: input.constraints?.maxCostImpact,
        simulationRequired: input.constraints?.simulationRequired,
        simulationPeriodDays: input.constraints?.simulationPeriodDays,
        dependsOn: input.constraints?.dependsOn,
        excludeResources: input.constraints?.excludeResources,
        excludeTags: input.constraints?.excludeTags,
      },

      execution: {
        preChecks: input.execution?.preChecks || [],
        action:
          input.execution?.action ||
          template?.template?.execution?.action ||
          {},
        postChecks: input.execution?.postChecks || [],
        rollback: input.execution?.rollback,
        retry: input.execution?.retry,
      },

      audit: {
        logLevel: input.audit?.logLevel || 'standard',
        notify: input.audit?.notify || [],
        complianceTags: input.audit?.complianceTags || [],
        retentionDays: input.audit?.retentionDays,
      },
    };
  }

  /**
   * Validate DSL structure and constraints
   */
  private validateDSL(
    dsl: ActionDefinition,
    errors: ValidationError[],
    warnings: ValidationWarning[],
  ): void {
    // Version validation
    if (!DSL_VERSION_HISTORY.find((v) => v.version === dsl.version)) {
      errors.push({
        field: 'version',
        message: `Unknown DSL version: ${dsl.version}`,
        code: 'INVALID_VERSION',
      });
    }

    // Action validation
    if (!dsl.action || !dsl.action.includes(':')) {
      errors.push({
        field: 'action',
        message: 'Action must be in format "service:action"',
        code: 'INVALID_ACTION_FORMAT',
      });
    }

    // Service validation
    const [service] = dsl.action.split(':');
    if (!service) {
      errors.push({
        field: 'action',
        message: 'Action must specify a service',
        code: 'MISSING_SERVICE',
      });
    }

    // Risk level validation
    const validRiskLevels: Array<'low' | 'medium' | 'high' | 'critical'> = [
      'low',
      'medium',
      'high',
      'critical',
    ];
    if (!validRiskLevels.includes(dsl.metadata.risk)) {
      errors.push({
        field: 'metadata.risk',
        message: `Invalid risk level: ${dsl.metadata.risk}`,
        code: 'INVALID_RISK_LEVEL',
      });
    }

    // Cost impact validation
    const validCostImpacts: Array<
      'negative' | 'neutral' | 'positive' | 'unknown'
    > = ['negative', 'neutral', 'positive', 'unknown'];
    if (!validCostImpacts.includes(dsl.metadata.costImpact)) {
      errors.push({
        field: 'metadata.costImpact',
        message: `Invalid cost impact: ${dsl.metadata.costImpact}`,
        code: 'INVALID_COST_IMPACT',
      });
    }

    // Constraints validation
    if (dsl.constraints.maxResources < 1) {
      errors.push({
        field: 'constraints.maxResources',
        message: 'maxResources must be at least 1',
        code: 'INVALID_MAX_RESOURCES',
      });
    }

    // Time window validation
    if (dsl.constraints.timeWindow) {
      const tw = dsl.constraints.timeWindow;
      if (
        tw.startHour !== undefined &&
        (tw.startHour < 0 || tw.startHour > 23)
      ) {
        errors.push({
          field: 'constraints.timeWindow.startHour',
          message: 'startHour must be between 0 and 23',
          code: 'INVALID_TIME_WINDOW',
        });
      }
      if (tw.endHour !== undefined && (tw.endHour < 0 || tw.endHour > 23)) {
        errors.push({
          field: 'constraints.timeWindow.endHour',
          message: 'endHour must be between 0 and 23',
          code: 'INVALID_TIME_WINDOW',
        });
      }
    }

    // Warn about high-risk actions without approval
    if (dsl.metadata.risk === 'high' || dsl.metadata.risk === 'critical') {
      if (!dsl.constraints.requireApproval) {
        warnings.push({
          field: 'constraints.requireApproval',
          message: 'High-risk actions should require approval',
          suggestion: 'Set requireApproval to true',
        });
      }
    }

    // Validate filters
    for (const filter of dsl.selector.filters) {
      if (!filter.field || !filter.operator) {
        errors.push({
          field: 'selector.filters',
          message: 'Filter must have field and operator',
          code: 'INVALID_FILTER',
        });
      }
    }
  }

  /**
   * Generate SHA-256 hash of DSL for audit purposes
   */
  hashDSL(dsl: ActionDefinition): string {
    const dslString = JSON.stringify(dsl, Object.keys(dsl).sort());
    return createHash('sha256').update(dslString).digest('hex');
  }

  /**
   * Verify DSL hash matches
   */
  verifyHash(dsl: ActionDefinition, expectedHash: string): boolean {
    const calculatedHash = this.hashDSL(dsl);
    return calculatedHash === expectedHash;
  }

  /**
   * Sign DSL for non-repudiation (optional)
   */
  private signDSL(dsl: ActionDefinition): string | undefined {
    const signingKey = process.env.DSL_SIGNING_KEY;
    if (!signingKey) {
      return undefined; // Signing not configured
    }

    const dslString = JSON.stringify(dsl, Object.keys(dsl).sort());
    return createHmac('sha256', signingKey).update(dslString).digest('hex');
  }

  /**
   * Check if action is allowed
   */
  isActionAllowed(action: string): boolean {
    return ALLOWED_ACTION_SET.has(action);
  }

  /**
   * Generate template for an action
   */
  generateTemplate(action: string): ActionDefinition | null {
    const template = ALLOWED_ACTIONS.find((a) => a.action === action);
    if (!template || !template.template) {
      return null;
    }

    return {
      action,
      version: CURRENT_DSL_VERSION,
      metadata: { ...DEFAULT_METADATA, ...template.template.metadata },
      selector: { ...DEFAULT_SELECTOR, ...template.template.selector },
      constraints: { ...DEFAULT_CONSTRAINTS, ...template.template.constraints },
      execution: { ...DEFAULT_EXECUTION, ...template.template.execution },
      audit: { ...DEFAULT_AUDIT, ...template.template.audit },
    };
  }

  /**
   * Get current DSL version
   */
  getCurrentVersion(): DSLVersion {
    return CURRENT_DSL_VERSION;
  }

  /**
   * Get DSL version history
   */
  getVersionHistory() {
    return DSL_VERSION_HISTORY;
  }
}
