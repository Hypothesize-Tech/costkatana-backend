/**
 * Tool Schema Definitions
 */

import { IntegrationType, HttpMethod } from './permission.types';

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required: boolean;
  default?: any;
  enum?: any[];
  pattern?: string;
}

export interface ToolSchema {
  name: string;
  integration: IntegrationType;
  description: string;
  httpMethod: HttpMethod;
  parameters: ToolParameter[];
  requiredScopes: string[];
  dangerous: boolean;
  examples?: string[];
  version: string;
}

export interface ToolRegistryEntry {
  schema: ToolSchema;
  handler: ToolHandler;
  enabled: boolean;
  rateLimitOverride?: number;
}

export type ToolHandler = (
  params: any,
  context: ToolExecutionContext
) => Promise<any>;

export interface ToolExecutionContext {
  userId: string;
  connectionId: string;
  integration: IntegrationType;
  permissions: string[];
  scopes: string[];
  isAdmin: boolean;
}

export interface ToolValidationResult {
  valid: boolean;
  errors?: Array<{
    parameter: string;
    message: string;
  }>;
}

/**
 * Validate tool parameters against schema
 */
export function validateToolParameters(
  params: any,
  schema: ToolSchema
): ToolValidationResult {
  const errors: Array<{ parameter: string; message: string }> = [];

  // Check required parameters
  for (const param of schema.parameters) {
    if (param.required && (params[param.name] === undefined || params[param.name] === null)) {
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
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
  };
}
