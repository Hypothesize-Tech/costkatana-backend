/**
 * Cortex Schema Validation Service
 * 
 * Provides GraphQL-style validation for Cortex structures to ensure integrity
 * before expensive LLM processing. Acts as a "spellchecker" for Cortex frames,
 * preventing costly errors and guaranteeing predictable output structure.
 */

import { CortexFrame, CortexFrameType, CortexPrimitive } from '../types/cortex.types';
import { loggingService } from './logging.service';

// ============================================================================
// SCHEMA VALIDATION TYPES
// ============================================================================

export interface CortexSchemaDefinition {
    frameType: CortexFrameType;
    name: string;
    description: string;
    requiredRoles: string[];
    optionalRoles: string[];
    deprecatedRoles: string[];
    roleSchemas: Record<string, CortexRoleSchema>;
    constraints?: CortexConstraints;
    examples: CortexFrame[];
}

export interface CortexRoleSchema {
    role: string;
    description: string;
    dataType: 'primitive' | 'string' | 'number' | 'boolean' | 'array' | 'object' | 'any';
    required: boolean;
    deprecated?: boolean;
    constraints?: {
        minLength?: number;
        maxLength?: number;
        pattern?: RegExp;
        enum?: string[];
        min?: number;
        max?: number;
        format?: 'email' | 'url' | 'date' | 'uuid' | 'primitive';
    };
    validation?: (value: any) => ValidationResult;
    examples: any[];
}

export interface CortexConstraints {
    maxRoles?: number;
    minRoles?: number;
    mutuallyExclusive?: string[][];
    conditionalRequired?: Array<{
        if: string;
        then: string[];
        description: string;
    }>;
    customValidations?: Array<{
        name: string;
        description: string;
        validate: (frame: CortexFrame) => ValidationResult;
    }>;
}

export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
    score: number; // 0-100 quality score
}

export interface ValidationError {
    code: ValidationErrorCode;
    message: string;
    path: string;
    severity: 'critical' | 'error' | 'warning';
    fix?: {
        description: string;
        autoFixable: boolean;
        suggestedFix?: any;
    };
}

export interface ValidationWarning {
    code: string;
    message: string;
    path: string;
    suggestion?: string;
}

export enum ValidationErrorCode {
    MISSING_FRAME_TYPE = 'MISSING_FRAME_TYPE',
    INVALID_FRAME_TYPE = 'INVALID_FRAME_TYPE',
    MISSING_REQUIRED_ROLE = 'MISSING_REQUIRED_ROLE',
    INVALID_ROLE_TYPE = 'INVALID_ROLE_TYPE',
    INVALID_PRIMITIVE_FORMAT = 'INVALID_PRIMITIVE_FORMAT',
    DEPRECATED_ROLE_USAGE = 'DEPRECATED_ROLE_USAGE',
    MUTUALLY_EXCLUSIVE_ROLES = 'MUTUALLY_EXCLUSIVE_ROLES',
    CONDITIONAL_REQUIREMENT_FAILED = 'CONDITIONAL_REQUIREMENT_FAILED',
    CONSTRAINT_VIOLATION = 'CONSTRAINT_VIOLATION',
    SCHEMA_NOT_FOUND = 'SCHEMA_NOT_FOUND',
    CUSTOM_VALIDATION_FAILED = 'CUSTOM_VALIDATION_FAILED'
}

// ============================================================================
// CORTEX FRAME SCHEMAS
// ============================================================================

const QUERY_FRAME_SCHEMA: CortexSchemaDefinition = {
    frameType: 'query',
    name: 'Query Frame',
    description: 'Represents a question or information request',
    requiredRoles: ['action'],
    optionalRoles: ['agent', 'object', 'target', 'context', 'time', 'location', 'method'],
    deprecatedRoles: [],
    roleSchemas: {
        action: {
            role: 'action',
            description: 'The action being requested (verb)',
            dataType: 'primitive',
            required: true,
            constraints: {
                format: 'primitive',
                pattern: /^action_[a-z_]+$/,
                enum: ['action_get', 'action_find', 'action_search', 'action_analyze', 'action_compare', 'action_explain']
            },
            examples: ['action_get', 'action_find', 'action_analyze']
        },
        agent: {
            role: 'agent',
            description: 'Who or what is performing the query',
            dataType: 'primitive',
            required: false,
            constraints: {
                format: 'primitive',
                pattern: /^agent_[a-z_]+$/
            },
            examples: ['agent_user', 'agent_system', 'agent_admin']
        },
        object: {
            role: 'object',
            description: 'The target of the query',
            dataType: 'primitive',
            required: false,
            constraints: {
                format: 'primitive',
                minLength: 1,
                maxLength: 100
            },
            examples: ['object_data', 'object_file', 'object_user_profile']
        },
        target: {
            role: 'target',
            description: 'Specific target identifier',
            dataType: 'string',
            required: false,
            examples: ['user_123', 'file_abc.txt', 'database_main']
        }
    },
    constraints: {
        maxRoles: 8,
        minRoles: 1,
        conditionalRequired: [
            {
                if: 'action',
                then: ['object'],
                description: 'Query actions typically require an object'
            }
        ]
    },
    examples: [
        {
            frameType: 'query',
            action: 'action_get',
            agent: 'agent_user',
            object: 'object_user_profile'
        }
    ]
};

const EVENT_FRAME_SCHEMA: CortexSchemaDefinition = {
    frameType: 'event',
    name: 'Event Frame',
    description: 'Represents an action or occurrence',
    requiredRoles: ['action'],
    optionalRoles: ['agent', 'object', 'target', 'time', 'location', 'method', 'result', 'context'],
    deprecatedRoles: ['old_action'],
    roleSchemas: {
        action: {
            role: 'action',
            description: 'The action being performed',
            dataType: 'primitive',
            required: true,
            constraints: {
                format: 'primitive',
                pattern: /^action_[a-z_]+$/,
                enum: ['action_create', 'action_update', 'action_delete', 'action_execute', 'action_send', 'action_process']
            },
            examples: ['action_create', 'action_update', 'action_execute']
        },
        agent: {
            role: 'agent',
            description: 'Who or what is performing the action',
            dataType: 'primitive',
            required: false,
            constraints: {
                format: 'primitive',
                pattern: /^agent_[a-z_]+$/
            },
            examples: ['agent_user', 'agent_system']
        },
        tense: {
            role: 'tense',
            description: 'When the action occurs',
            dataType: 'primitive',
            required: false,
            constraints: {
                format: 'primitive',
                enum: ['past', 'present', 'future']
            },
            examples: ['present', 'past', 'future']
        }
    },
    constraints: {
        maxRoles: 10,
        minRoles: 1,
        mutuallyExclusive: [
            ['time', 'tense']
        ]
    },
    examples: [
        {
            frameType: 'event',
            action: 'action_create',
            agent: 'agent_user',
            object: 'object_document',
            tense: 'present'
        }
    ]
};

const STATE_FRAME_SCHEMA: CortexSchemaDefinition = {
    frameType: 'state',
    name: 'State Frame',
    description: 'Represents current state or property of an entity',
    requiredRoles: ['entity', 'property', 'value'],
    optionalRoles: ['time', 'context', 'source', 'confidence'],
    deprecatedRoles: [],
    roleSchemas: {
        entity: {
            role: 'entity',
            description: 'The entity being described',
            dataType: 'primitive',
            required: true,
            constraints: {
                format: 'primitive',
                minLength: 1
            },
            examples: ['entity_user_john', 'entity_product_tesla_model_3', 'entity_system_status']
        },
        property: {
            role: 'property',
            description: 'The property or attribute',
            dataType: 'primitive',
            required: true,
            constraints: {
                format: 'primitive',
                pattern: /^property_[a-z_]+$/
            },
            examples: ['property_status', 'property_price', 'property_name']
        },
        value: {
            role: 'value',
            description: 'The current value of the property',
            dataType: 'any',
            required: true,
            examples: ['value_active', 'value_35000_usd', 'John Smith']
        }
    },
    examples: [
        {
            frameType: 'state',
            entity: 'entity_product_tesla_model_3',
            property: 'property_price',
            value: 'value_35000_usd'
        }
    ]
};

const ENTITY_FRAME_SCHEMA: CortexSchemaDefinition = {
    frameType: 'entity',
    name: 'Entity Frame',
    description: 'Represents an entity with its properties',
    requiredRoles: ['type', 'name'],
    optionalRoles: ['properties', 'context', 'id', 'category'],
    deprecatedRoles: [],
    roleSchemas: {
        type: {
            role: 'type',
            description: 'The type or category of entity',
            dataType: 'primitive',
            required: true,
            constraints: {
                format: 'primitive',
                enum: ['type_person', 'type_company', 'type_product', 'type_service', 'type_location', 'type_document']
            },
            examples: ['type_person', 'type_product', 'type_company']
        },
        name: {
            role: 'name',
            description: 'The name or identifier of the entity',
            dataType: 'string',
            required: true,
            constraints: {
                minLength: 1,
                maxLength: 200
            },
            examples: ['John Smith', 'Tesla Model 3', 'Microsoft Corporation']
        },
        properties: {
            role: 'properties',
            description: 'Additional properties of the entity',
            dataType: 'object',
            required: false,
            examples: [{ age: 30, role: 'developer' }]
        }
    },
    examples: [
        {
            frameType: 'entity',
            type: 'type_person' as CortexPrimitive,
            name: 'John Smith',
            role: 'developer',
            department: 'engineering'
        }
    ]
};

const LIST_FRAME_SCHEMA: CortexSchemaDefinition = {
    frameType: 'list',
    name: 'List Frame',
    description: 'Represents a collection of items',
    requiredRoles: ['items'],
    optionalRoles: ['type', 'count', 'context', 'filter'],
    deprecatedRoles: [],
    roleSchemas: {
        items: {
            role: 'items',
            description: 'Array of items in the list',
            dataType: 'array',
            required: true,
            constraints: {
                minLength: 0,
                maxLength: 100
            },
            examples: [['item1', 'item2'], ['action_create', 'action_update']]
        },
        type: {
            role: 'type',
            description: 'The type of items in the list',
            dataType: 'primitive',
            required: false,
            constraints: {
                format: 'primitive'
            },
            examples: ['type_action', 'type_entity', 'type_string']
        }
    },
    examples: [
        {
            frameType: 'list',
            items: ['action_create', 'action_update', 'action_delete'],
            type: 'type_action'
        }
    ]
};

const ERROR_FRAME_SCHEMA: CortexSchemaDefinition = {
    frameType: 'error',
    name: 'Error Frame',
    description: 'Represents an error or problem',
    requiredRoles: ['type', 'message'],
    optionalRoles: ['code', 'context', 'severity', 'source'],
    deprecatedRoles: [],
    roleSchemas: {
        type: {
            role: 'type',
            description: 'The type of error',
            dataType: 'primitive',
            required: true,
            constraints: {
                format: 'primitive',
                enum: ['error_validation', 'error_processing', 'error_network', 'error_auth', 'error_not_found']
            },
            examples: ['error_validation', 'error_processing']
        },
        message: {
            role: 'message',
            description: 'Human-readable error message',
            dataType: 'string',
            required: true,
            constraints: {
                minLength: 1,
                maxLength: 500
            },
            examples: ['Invalid input provided', 'Network connection failed']
        },
        severity: {
            role: 'severity',
            description: 'Severity level of the error',
            dataType: 'primitive',
            required: false,
            constraints: {
                enum: ['critical', 'error', 'warning', 'info']
            },
            examples: ['critical', 'error', 'warning']
        }
    },
    examples: [
        {
            frameType: 'error',
            code: 'E001',
            type: 'error_validation',
            message: 'Required field missing',
            severity: 'error'
        }
    ]
};

// Control flow schemas (simplified)
const CONTROL_FRAME_SCHEMA: CortexSchemaDefinition = {
    frameType: 'control',
    name: 'Control Frame',
    description: 'Generic control flow frame',
    requiredRoles: ['controlType'],
    optionalRoles: ['steps', 'metadata'],
    deprecatedRoles: [],
    roleSchemas: {},
    examples: []
};

const CONDITIONAL_FRAME_SCHEMA: CortexSchemaDefinition = {
    frameType: 'conditional',
    name: 'Conditional Frame',
    description: 'If/then/else conditional logic frame',
    requiredRoles: ['condition', 'thenBranch'],
    optionalRoles: ['elseBranch', 'elseIfBranches'],
    deprecatedRoles: [],
    roleSchemas: {},
    examples: []
};

const LOOP_FRAME_SCHEMA: CortexSchemaDefinition = {
    frameType: 'loop',
    name: 'Loop Frame',
    description: 'Iteration control frame',
    requiredRoles: ['loopType', 'body', 'maxIterations'],
    optionalRoles: ['condition', 'iterationVariable', 'iterationSource', 'counter'],
    deprecatedRoles: [],
    roleSchemas: {},
    examples: []
};

const SEQUENCE_FRAME_SCHEMA: CortexSchemaDefinition = {
    frameType: 'sequence',
    name: 'Sequence Frame',  
    description: 'Sequential execution frame',
    requiredRoles: ['steps'],
    optionalRoles: ['stopOnError', 'collectResults', 'variables'],
    deprecatedRoles: [],
    roleSchemas: {},
    examples: []
};

// Schema registry
const CORTEX_SCHEMAS: Record<CortexFrameType, CortexSchemaDefinition> = {
    'query': QUERY_FRAME_SCHEMA,
    'answer': QUERY_FRAME_SCHEMA, // Reuse query schema for answers
    'event': EVENT_FRAME_SCHEMA,
    'state': STATE_FRAME_SCHEMA,
    'entity': ENTITY_FRAME_SCHEMA,
    'list': LIST_FRAME_SCHEMA,
    'error': ERROR_FRAME_SCHEMA,
    'control': CONTROL_FRAME_SCHEMA,
    'conditional': CONDITIONAL_FRAME_SCHEMA,
    'loop': LOOP_FRAME_SCHEMA,
    'sequence': SEQUENCE_FRAME_SCHEMA
};

// ============================================================================
// CORTEX SCHEMA VALIDATOR SERVICE
// ============================================================================

export class CortexSchemaValidatorService {
    private static instance: CortexSchemaValidatorService;

    private constructor() {}

    public static getInstance(): CortexSchemaValidatorService {
        if (!CortexSchemaValidatorService.instance) {
            CortexSchemaValidatorService.instance = new CortexSchemaValidatorService();
        }
        return CortexSchemaValidatorService.instance;
    }

    /**
     * Validate a Cortex frame against its schema
     */
    public validateFrame(frame: CortexFrame, strict = false): ValidationResult {
        const startTime = Date.now();
        const errors: ValidationError[] = [];
        const warnings: ValidationWarning[] = [];

        try {
            // Check if frame type exists
            if (!frame.frameType) {
                errors.push({
                    code: ValidationErrorCode.MISSING_FRAME_TYPE,
                    message: 'Frame type is required',
                    path: 'frameType',
                    severity: 'critical',
                    fix: {
                        description: 'Add frameType property',
                        autoFixable: false
                    }
                });
                
                return { valid: false, errors, warnings, score: 0 };
            }

            // Get schema for frame type
            const schema = CORTEX_SCHEMAS[frame.frameType];
            if (!schema) {
                errors.push({
                    code: ValidationErrorCode.SCHEMA_NOT_FOUND,
                    message: `No schema found for frame type: ${frame.frameType}`,
                    path: 'frameType',
                    severity: 'critical'
                });
                
                return { valid: false, errors, warnings, score: 0 };
            }

            // Validate frame structure
            this.validateFrameStructure(frame, schema, errors, warnings, strict);
            
            // Validate role data types and constraints
            this.validateRoleConstraints(frame, schema, errors, warnings, strict);
            
            // Validate schema-level constraints
            this.validateSchemaConstraints(frame, schema, errors, warnings, strict);
            
            // Calculate quality score
            const score = this.calculateQualityScore(frame, schema, errors, warnings);

            loggingService.debug('🔍 Cortex schema validation completed', {
                frameType: frame.frameType,
                valid: errors.length === 0,
                errorCount: errors.length,
                warningCount: warnings.length,
                score,
                processingTime: Date.now() - startTime
            });

            return {
                valid: errors.filter(e => e.severity === 'critical' || e.severity === 'error').length === 0,
                errors,
                warnings,
                score
            };

        } catch (error) {
            loggingService.error('❌ Schema validation failed', {
                error: error instanceof Error ? error.message : String(error),
                frameType: frame.frameType
            });

            errors.push({
                code: ValidationErrorCode.CUSTOM_VALIDATION_FAILED,
                message: `Schema validation error: ${error instanceof Error ? error.message : String(error)}`,
                path: 'root',
                severity: 'critical'
            });

            return { valid: false, errors, warnings, score: 0 };
        }
    }

    /**
     * Get available schemas
     */
    public getSchemas(): Record<CortexFrameType, CortexSchemaDefinition> {
        return CORTEX_SCHEMAS;
    }

    /**
     * Get schema for specific frame type
     */
    public getSchema(frameType: CortexFrameType): CortexSchemaDefinition | undefined {
        return CORTEX_SCHEMAS[frameType];
    }

    // ========================================================================
    // PRIVATE VALIDATION METHODS
    // ========================================================================

    private validateFrameStructure(
        frame: CortexFrame,
        schema: CortexSchemaDefinition,
        errors: ValidationError[],
        warnings: ValidationWarning[],
        strict: boolean
    ): void {
        // Check required roles
        for (const requiredRole of schema.requiredRoles) {
            if (!(requiredRole in frame)) {
                errors.push({
                    code: ValidationErrorCode.MISSING_REQUIRED_ROLE,
                    message: `Required role '${requiredRole}' is missing`,
                    path: requiredRole,
                    severity: 'error',
                    fix: {
                        description: `Add required role '${requiredRole}'`,
                        autoFixable: false
                    }
                });
            }
        }

        // Check for deprecated roles
        for (const role of Object.keys(frame)) {
            if (role === 'frameType') continue;
            
            if (schema.deprecatedRoles.includes(role)) {
                warnings.push({
                    code: 'DEPRECATED_ROLE',
                    message: `Role '${role}' is deprecated`,
                    path: role,
                    suggestion: 'Consider updating to newer role names'
                });
            }
        }

        // Check for unknown roles in strict mode
        if (strict) {
            const allowedRoles = [...schema.requiredRoles, ...schema.optionalRoles, ...schema.deprecatedRoles];
            for (const role of Object.keys(frame)) {
                if (role === 'frameType') continue;
                
                if (!allowedRoles.includes(role)) {
                    warnings.push({
                        code: 'UNKNOWN_ROLE',
                        message: `Unknown role '${role}' found`,
                        path: role,
                        suggestion: 'Check if this role is correctly named'
                    });
                }
            }
        }
    }

    private validateRoleConstraints(
        frame: CortexFrame,
        schema: CortexSchemaDefinition,
        errors: ValidationError[],
        warnings: ValidationWarning[],
        strict: boolean
    ): void {
        for (const [role, value] of Object.entries(frame)) {
            if (role === 'frameType') continue;

            const roleSchema = schema.roleSchemas[role];
            if (!roleSchema) continue;

            // Validate data type
            const typeValidation = this.validateDataType(value, roleSchema.dataType);
            if (!typeValidation.valid) {
                errors.push({
                    code: ValidationErrorCode.INVALID_ROLE_TYPE,
                    message: `Role '${role}' has invalid data type. Expected: ${roleSchema.dataType}`,
                    path: role,
                    severity: 'error'
                });
            }

            // Validate constraints
            if (roleSchema.constraints) {
                this.validateRoleConstraint(role, value, roleSchema.constraints, errors, warnings);
            }
        }
    }

    private validateDataType(value: any, expectedType: string): { valid: boolean; actualType: string } {
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        
        switch (expectedType) {
            case 'primitive':
                return { valid: typeof value === 'string', actualType };
            case 'string':
                return { valid: typeof value === 'string', actualType };
            case 'number':
                return { valid: typeof value === 'number', actualType };
            case 'boolean':
                return { valid: typeof value === 'boolean', actualType };
            case 'array':
                return { valid: Array.isArray(value), actualType };
            case 'object':
                return { valid: typeof value === 'object' && value !== null && !Array.isArray(value), actualType };
            case 'any':
                return { valid: true, actualType };
            default:
                return { valid: false, actualType };
        }
    }

    private validateRoleConstraint(
        role: string,
        value: any,
        constraints: any,
        errors: ValidationError[],
        warnings: ValidationWarning[]
    ): void {
        // String constraints
        if (typeof value === 'string') {
            if (constraints.minLength && value.length < constraints.minLength) {
                errors.push({
                    code: ValidationErrorCode.CONSTRAINT_VIOLATION,
                    message: `Role '${role}' is too short. Minimum length: ${constraints.minLength}`,
                    path: role,
                    severity: 'error'
                });
            }

            if (constraints.maxLength && value.length > constraints.maxLength) {
                errors.push({
                    code: ValidationErrorCode.CONSTRAINT_VIOLATION,
                    message: `Role '${role}' is too long. Maximum length: ${constraints.maxLength}`,
                    path: role,
                    severity: 'error'
                });
            }

            if (constraints.pattern && !constraints.pattern.test(value)) {
                errors.push({
                    code: ValidationErrorCode.INVALID_PRIMITIVE_FORMAT,
                    message: `Role '${role}' does not match expected pattern`,
                    path: role,
                    severity: 'error'
                });
            }
        }

        // Enum constraints
        if (constraints.enum && !constraints.enum.includes(value)) {
            errors.push({
                code: ValidationErrorCode.CONSTRAINT_VIOLATION,
                message: `Role '${role}' has invalid value. Allowed values: ${constraints.enum.join(', ')}`,
                path: role,
                severity: 'error',
                fix: {
                    description: 'Use one of the allowed values',
                    autoFixable: false,
                    suggestedFix: constraints.enum[0]
                }
            });
        }

        // Number constraints
        if (typeof value === 'number') {
            if (constraints.min !== undefined && value < constraints.min) {
                errors.push({
                    code: ValidationErrorCode.CONSTRAINT_VIOLATION,
                    message: `Role '${role}' is below minimum value: ${constraints.min}`,
                    path: role,
                    severity: 'error'
                });
            }

            if (constraints.max !== undefined && value > constraints.max) {
                errors.push({
                    code: ValidationErrorCode.CONSTRAINT_VIOLATION,
                    message: `Role '${role}' exceeds maximum value: ${constraints.max}`,
                    path: role,
                    severity: 'error'
                });
            }
        }
    }

    private validateSchemaConstraints(
        frame: CortexFrame,
        schema: CortexSchemaDefinition,
        errors: ValidationError[],
        warnings: ValidationWarning[],
        strict: boolean
    ): void {
        const constraints = schema.constraints;
        if (!constraints) return;

        const roleCount = Object.keys(frame).filter(k => k !== 'frameType').length;

        // Role count constraints
        if (constraints.minRoles && roleCount < constraints.minRoles) {
            errors.push({
                code: ValidationErrorCode.CONSTRAINT_VIOLATION,
                message: `Frame has too few roles. Minimum: ${constraints.minRoles}, actual: ${roleCount}`,
                path: 'root',
                severity: 'error'
            });
        }

        if (constraints.maxRoles && roleCount > constraints.maxRoles) {
            errors.push({
                code: ValidationErrorCode.CONSTRAINT_VIOLATION,
                message: `Frame has too many roles. Maximum: ${constraints.maxRoles}, actual: ${roleCount}`,
                path: 'root',
                severity: 'error'
            });
        }

        // Mutually exclusive constraints
        if (constraints.mutuallyExclusive) {
            for (const exclusiveGroup of constraints.mutuallyExclusive) {
                const presentRoles = exclusiveGroup.filter(role => role in frame);
                if (presentRoles.length > 1) {
                    errors.push({
                        code: ValidationErrorCode.MUTUALLY_EXCLUSIVE_ROLES,
                        message: `Roles are mutually exclusive: ${presentRoles.join(', ')}`,
                        path: presentRoles.join(','),
                        severity: 'error'
                    });
                }
            }
        }

        // Conditional requirements
        if (constraints.conditionalRequired) {
            for (const condition of constraints.conditionalRequired) {
                if (condition.if in frame) {
                    const missingRequired = condition.then.filter(role => !(role in frame));
                    if (missingRequired.length > 0) {
                        errors.push({
                            code: ValidationErrorCode.CONDITIONAL_REQUIREMENT_FAILED,
                            message: `${condition.description}. Missing: ${missingRequired.join(', ')}`,
                            path: condition.if,
                            severity: 'warning'
                        });
                    }
                }
            }
        }

        // Custom validations
        if (constraints.customValidations) {
            for (const customValidation of constraints.customValidations) {
                const result = customValidation.validate(frame);
                if (!result.valid) {
                    errors.push(...result.errors);
                    warnings.push(...result.warnings);
                }
            }
        }
    }

    private calculateQualityScore(
        frame: CortexFrame,
        schema: CortexSchemaDefinition,
        errors: ValidationError[],
        warnings: ValidationWarning[]
    ): number {
        let score = 100;

        // Deduct points for errors
        score -= errors.filter(e => e.severity === 'critical').length * 25;
        score -= errors.filter(e => e.severity === 'error').length * 15;
        score -= errors.filter(e => e.severity === 'warning').length * 5;

        // Deduct points for warnings
        score -= warnings.length * 2;

        // Bonus points for completeness
        const requiredRolesPresent = schema.requiredRoles.filter(role => role in frame).length;
        const requiredRolesRatio = requiredRolesPresent / schema.requiredRoles.length;
        score += requiredRolesRatio * 10;

        // Bonus points for using optional roles (shows richness)
        const optionalRolesPresent = schema.optionalRoles.filter(role => role in frame).length;
        const optionalRolesBonus = Math.min(optionalRolesPresent * 2, 10);
        score += optionalRolesBonus;

        return Math.max(0, Math.min(100, score));
    }
}
