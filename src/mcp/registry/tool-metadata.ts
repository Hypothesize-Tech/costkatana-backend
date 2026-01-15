/**
 * Tool Metadata Management
 * Manages tool schemas and metadata
 */

import { ToolSchema, ToolParameter } from '../types/tool-schema';
import { IntegrationType, HttpMethod } from '../types/permission.types';

/**
 * Create a tool schema
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
  } = {}
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
 * Create a tool parameter
 */
export function createParameter(
  name: string,
  type: ToolParameter['type'],
  description: string,
  options: {
    required?: boolean;
    default?: any;
    enum?: any[];
    pattern?: string;
  } = {}
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
 * Common parameter definitions
 */
export const CommonParameters = {
  projectId: createParameter('projectId', 'string', 'Project ID or name', { required: true }),
  projectName: createParameter('projectName', 'string', 'Project name', { required: true }),
  deploymentId: createParameter('deploymentId', 'string', 'Deployment ID', { required: true }),
  repoName: createParameter('repoName', 'string', 'Repository name', { required: true }),
  issueNumber: createParameter('issueNumber', 'number', 'Issue number', { required: true }),
  title: createParameter('title', 'string', 'Title', { required: true }),
  description: createParameter('description', 'string', 'Description', { required: false }),
  limit: createParameter('limit', 'number', 'Maximum number of results', { 
    required: false, 
    default: 20 
  }),
  state: createParameter('state', 'string', 'State filter', { 
    required: false, 
    enum: ['open', 'closed', 'all'] 
  }),
};

/**
 * Tool categories
 */
export const ToolCategories = {
  LIST: 'list',
  GET: 'get',
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  DEPLOY: 'deploy',
  MANAGE: 'manage',
} as const;

/**
 * Get category from tool name
 */
export function getToolCategory(toolName: string): string {
  if (toolName.includes('_list')) return ToolCategories.LIST;
  if (toolName.includes('_get')) return ToolCategories.GET;
  if (toolName.includes('_create')) return ToolCategories.CREATE;
  if (toolName.includes('_update')) return ToolCategories.UPDATE;
  if (toolName.includes('_delete')) return ToolCategories.DELETE;
  if (toolName.includes('_deploy') || toolName.includes('_rollback')) return ToolCategories.DEPLOY;
  return ToolCategories.MANAGE;
}

/**
 * Check if tool is dangerous
 */
export function isDangerousTool(toolName: string, httpMethod: HttpMethod): boolean {
  // DELETE operations are always dangerous
  if (httpMethod === 'DELETE') {
    return true;
  }

  // Specific dangerous operations
  const dangerousPatterns = [
    '_delete',
    '_remove',
    '_drop',
    '_destroy',
    '_rollback',
    '_force',
    '_ban',
    '_kick',
  ];

  return dangerousPatterns.some(pattern => toolName.toLowerCase().includes(pattern));
}
