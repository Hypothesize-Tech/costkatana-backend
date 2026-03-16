/**
 * Tool Parameter Validation and Schema Creation Helpers
 * Provides utilities for creating tool schemas and validating parameters
 */

import {
  ToolParameter,
  ToolSchema,
  ToolValidationResult,
  IntegrationType,
  HttpMethod,
} from '../types/mcp.types';

/**
 * Creates a tool parameter definition
 */
export function createParameter(
  name: string,
  type: 'string' | 'number' | 'boolean' | 'array' | 'object',
  description: string,
  options: {
    required?: boolean;
    default?: any;
    enum?: any[];
    pattern?: string;
  } = {},
): ToolParameter {
  return {
    name,
    type,
    description,
    required: options.required ?? false,
    default: options.default,
    enum: options.enum,
    pattern: options.pattern,
  };
}

/**
 * Creates a complete tool schema
 */
export function createToolSchema(
  name: string,
  integration: IntegrationType,
  description: string,
  httpMethod: HttpMethod,
  parameters: ToolParameter[],
  options: {
    requiredScopes?: string[];
    dangerous?: boolean;
    examples?: string[];
    version?: string;
  } = {},
): ToolSchema {
  return {
    name,
    integration,
    description,
    httpMethod,
    parameters,
    requiredScopes: options.requiredScopes || [],
    dangerous: options.dangerous || false,
    examples: options.examples,
    version: options.version || '1.0.0',
  };
}

/**
 * Validates tool parameters against a schema
 */
export function validateToolParameters(
  params: any,
  schema: ToolSchema,
): ToolValidationResult {
  const errors: Array<{ parameter: string; message: string }> = [];

  // Check required parameters
  for (const param of schema.parameters) {
    if (
      param.required &&
      (params[param.name] === undefined || params[param.name] === null)
    ) {
      errors.push({
        parameter: param.name,
        message: `Required parameter '${param.name}' is missing`,
      });
      continue;
    }

    if (params[param.name] !== undefined) {
      // Type validation
      const actualType = Array.isArray(params[param.name])
        ? 'array'
        : typeof params[param.name];

      if (actualType !== param.type && params[param.name] !== null) {
        errors.push({
          parameter: param.name,
          message: `Parameter '${param.name}' should be ${param.type}, got ${actualType}`,
        });
      }

      // Enum validation
      if (param.enum && !param.enum.includes(params[param.name])) {
        errors.push({
          parameter: param.name,
          message: `Parameter '${param.name}' must be one of: ${param.enum.join(', ')}`,
        });
      }

      // Pattern validation for strings
      if (param.pattern && typeof params[param.name] === 'string') {
        const regex = new RegExp(param.pattern);
        if (!regex.test(params[param.name])) {
          errors.push({
            parameter: param.name,
            message: `Parameter '${param.name}' does not match required pattern`,
          });
        }
      }

      // Numeric validation
      if (param.type === 'number' && typeof params[param.name] === 'number') {
        // Could add min/max validation here if needed
      }

      // Array validation
      if (param.type === 'array' && Array.isArray(params[param.name])) {
        // Could add item validation here if needed
      }

      // Object validation
      if (
        param.type === 'object' &&
        typeof params[param.name] === 'object' &&
        params[param.name] !== null
      ) {
        // Could add schema validation here if needed
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Sanitizes tool parameters (removes extra fields, sets defaults)
 */
export function sanitizeToolParameters(
  params: any,
  schema: ToolSchema,
): Record<string, any> {
  const sanitized: Record<string, any> = {};

  for (const param of schema.parameters) {
    if (params[param.name] !== undefined) {
      sanitized[param.name] = params[param.name];
    } else if (param.default !== undefined) {
      sanitized[param.name] = param.default;
    }
  }

  return sanitized;
}

/**
 * Common parameter definitions used across integrations
 */
export const CommonParameters = {
  // Project parameters
  projectId: createParameter('projectId', 'string', 'Vercel project ID', {
    required: true,
  }),
  projectName: createParameter('projectName', 'string', 'Project name', {
    required: true,
  }),

  // Repository parameters
  repoId: createParameter('repoId', 'string', 'Repository ID', {
    required: true,
  }),
  repoName: createParameter('repoName', 'string', 'Repository name', {
    required: true,
  }),

  // Issue/PR parameters
  issueId: createParameter('issueId', 'string', 'Issue ID', { required: true }),
  prId: createParameter('prId', 'string', 'Pull request ID', {
    required: true,
  }),

  // Deployment parameters
  deploymentId: createParameter('deploymentId', 'string', 'Deployment ID', {
    required: true,
  }),

  // File parameters
  fileId: createParameter('fileId', 'string', 'File ID', { required: true }),
  fileName: createParameter('fileName', 'string', 'File name', {
    required: true,
  }),

  // Channel parameters
  channelId: createParameter('channelId', 'string', 'Channel ID', {
    required: true,
  }),

  // Generic parameters
  title: createParameter('title', 'string', 'Title or name', {
    required: true,
  }),
  description: createParameter('description', 'string', 'Description text', {
    required: false,
  }),
  limit: createParameter('limit', 'number', 'Maximum number of results', {
    default: 20,
  }),
  offset: createParameter('offset', 'number', 'Offset for pagination', {
    default: 0,
  }),
  search: createParameter('search', 'string', 'Search query', {
    required: false,
  }),
  state: createParameter('state', 'string', 'State filter', {
    required: false,
  }),
} as const;
