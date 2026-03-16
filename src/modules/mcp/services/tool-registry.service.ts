/**
 * Tool Registry Service for MCP
 * Central registry for all integration tools with execution capabilities
 */

import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../../common/logger/logger.service';
import {
  ToolSchema,
  ToolRegistryEntry,
  ToolHandler,
  ToolExecutionContext,
  MCPToolDefinition,
  IntegrationType,
} from '../types/mcp.types';
import { validateToolParameters } from '../utils/tool-validation';

@Injectable()
export class ToolRegistryService {
  private tools = new Map<string, ToolRegistryEntry>();
  private toolsByIntegration = new Map<IntegrationType, Set<string>>();

  constructor(private logger: LoggerService) {}

  /**
   * Register a tool
   */
  registerTool(
    schema: ToolSchema,
    handler: ToolHandler,
    options: {
      enabled?: boolean;
      rateLimitOverride?: number;
    } = {},
  ): void {
    const entry: ToolRegistryEntry = {
      schema,
      handler,
      enabled: options.enabled ?? true,
      rateLimitOverride: options.rateLimitOverride,
    };

    this.tools.set(schema.name, entry);

    // Add to integration index
    if (!this.toolsByIntegration.has(schema.integration)) {
      this.toolsByIntegration.set(schema.integration, new Set());
    }
    this.toolsByIntegration.get(schema.integration)!.add(schema.name);

    this.logger.debug('Tool registered', {
      name: schema.name,
      integration: schema.integration,
      enabled: entry.enabled,
    });
  }

  /**
   * Get tool by name
   */
  getTool(name: string): ToolRegistryEntry | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all tools
   */
  getAllTools(): ToolRegistryEntry[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tools for specific integration
   */
  getToolsForIntegration(integration: IntegrationType): ToolRegistryEntry[] {
    const toolNames = this.toolsByIntegration.get(integration);
    if (!toolNames) {
      return [];
    }

    return Array.from(toolNames)
      .map((name) => this.tools.get(name))
      .filter((tool): tool is ToolRegistryEntry => tool !== undefined);
  }

  /**
   * Get enabled tools
   */
  getEnabledTools(): ToolRegistryEntry[] {
    return Array.from(this.tools.values()).filter((tool) => tool.enabled);
  }

  /**
   * Convert to MCP tool definitions
   */
  toMCPDefinitions(
    filterByIntegrations?: IntegrationType[],
  ): MCPToolDefinition[] {
    let tools = this.getEnabledTools();

    if (filterByIntegrations && filterByIntegrations.length > 0) {
      tools = tools.filter((tool) =>
        filterByIntegrations.includes(tool.schema.integration),
      );
    }

    return tools.map((tool) => this.schemaToMCPDefinition(tool.schema));
  }

  /**
   * Convert tool schema to MCP definition
   */
  private schemaToMCPDefinition(schema: ToolSchema): MCPToolDefinition {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const param of schema.parameters) {
      properties[param.name] = {
        type: param.type,
        description: param.description,
      };

      if (param.enum) {
        properties[param.name].enum = param.enum;
      }

      if (param.pattern) {
        properties[param.name].pattern = param.pattern;
      }

      if (param.default !== undefined) {
        properties[param.name].default = param.default;
      }

      if (param.required) {
        required.push(param.name);
      }
    }

    return {
      name: schema.name,
      description: schema.description,
      inputSchema: {
        type: 'object',
        properties,
        required: required.length > 0 ? required : undefined,
      },
    };
  }

  /**
   * Execute tool with parameter validation
   */
  async executeTool(
    toolName: string,
    params: any,
    context: ToolExecutionContext,
  ): Promise<any> {
    const tool = this.tools.get(toolName);

    if (!tool) {
      throw new Error(`Tool '${toolName}' not found`);
    }

    if (!tool.enabled) {
      throw new Error(`Tool '${toolName}' is disabled`);
    }

    // Validate parameters
    const validation = validateToolParameters(params, tool.schema);
    if (!validation.valid) {
      const errors = validation
        .errors!.map((e) => `${e.parameter}: ${e.message}`)
        .join('; ');
      throw new Error(`Invalid parameters: ${errors}`);
    }

    this.logger.log('Executing tool', {
      toolName,
      integration: tool.schema.integration,
      userId: context.userId,
      httpMethod: tool.schema.httpMethod,
    });

    try {
      const result = await tool.handler(params, context);

      this.logger.log('Tool executed successfully', {
        toolName,
        integration: tool.schema.integration,
        userId: context.userId,
      });

      return result;
    } catch (error) {
      this.logger.error('Tool execution failed', {
        toolName,
        integration: tool.schema.integration,
        userId: context.userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Enable/disable tool
   */
  setToolEnabled(toolName: string, enabled: boolean): boolean {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return false;
    }

    tool.enabled = enabled;

    this.logger.log('Tool enabled status changed', {
      toolName,
      enabled,
    });

    return true;
  }

  /**
   * Clear all tools (for testing)
   */
  clear(): void {
    this.tools.clear();
    this.toolsByIntegration.clear();
    this.logger.debug('Tool registry cleared');
  }

  /**
   * Get registry stats
   */
  getStats(): {
    totalTools: number;
    enabledTools: number;
    disabledTools: number;
    byIntegration: Record<string, number>;
  } {
    const byIntegration: Record<string, number> = {};

    for (const [integration, tools] of this.toolsByIntegration.entries()) {
      byIntegration[integration] = tools.size;
    }

    const enabled = this.getEnabledTools().length;

    return {
      totalTools: this.tools.size,
      enabledTools: enabled,
      disabledTools: this.tools.size - enabled,
      byIntegration,
    };
  }

  /**
   * Check if tool exists and is enabled
   */
  isToolAvailable(toolName: string): boolean {
    const tool = this.tools.get(toolName);
    return tool !== undefined && tool.enabled;
  }

  /**
   * Get tool schema
   */
  getToolSchema(toolName: string): ToolSchema | undefined {
    const tool = this.tools.get(toolName);
    return tool?.schema;
  }

  /**
   * Get tools by HTTP method
   */
  getToolsByHttpMethod(method: string): ToolRegistryEntry[] {
    return Array.from(this.tools.values()).filter(
      (tool) => tool.enabled && tool.schema.httpMethod === method,
    );
  }

  /**
   * Get dangerous tools (require confirmation)
   */
  getDangerousTools(): ToolRegistryEntry[] {
    return Array.from(this.tools.values()).filter(
      (tool) => tool.enabled && tool.schema.dangerous,
    );
  }

  /**
   * Validate tool exists for integration
   */
  validateToolForIntegration(
    toolName: string,
    integration: IntegrationType,
  ): boolean {
    const tool = this.tools.get(toolName);
    return (
      tool !== undefined &&
      tool.enabled &&
      tool.schema.integration === integration
    );
  }
}
