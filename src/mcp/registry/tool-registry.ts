/**
 * Tool Registry for MCP
 * Central registry for all integration tools
 */

import { loggingService } from '../../services/logging.service';
import { ToolSchema, ToolRegistryEntry, ToolHandler, ToolExecutionContext } from '../types/tool-schema';
import { MCPToolDefinition } from '../types/mcp.types';
import { IntegrationType } from '../types/permission.types';

export class ToolRegistry {
  private static tools = new Map<string, ToolRegistryEntry>();
  private static toolsByIntegration = new Map<IntegrationType, Set<string>>();

  /**
   * Register a tool
   */
  static registerTool(
    schema: ToolSchema,
    handler: ToolHandler,
    options: {
      enabled?: boolean;
      rateLimitOverride?: number;
    } = {}
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

    loggingService.debug('Tool registered', {
      name: schema.name,
      integration: schema.integration,
      enabled: entry.enabled,
    });
  }

  /**
   * Get tool by name
   */
  static getTool(name: string): ToolRegistryEntry | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all tools
   */
  static getAllTools(): ToolRegistryEntry[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tools for specific integration
   */
  static getToolsForIntegration(integration: IntegrationType): ToolRegistryEntry[] {
    const toolNames = this.toolsByIntegration.get(integration);
    if (!toolNames) {
      return [];
    }

    return Array.from(toolNames)
      .map(name => this.tools.get(name))
      .filter((tool): tool is ToolRegistryEntry => tool !== undefined);
  }

  /**
   * Get enabled tools
   */
  static getEnabledTools(): ToolRegistryEntry[] {
    return Array.from(this.tools.values()).filter(tool => tool.enabled);
  }

  /**
   * Convert to MCP tool definitions
   */
  static toMCPDefinitions(filterByIntegrations?: IntegrationType[]): MCPToolDefinition[] {
    let tools = this.getEnabledTools();

    if (filterByIntegrations && filterByIntegrations.length > 0) {
      tools = tools.filter(tool => 
        filterByIntegrations.includes(tool.schema.integration)
      );
    }

    return tools.map(tool => this.schemaToMCPDefinition(tool.schema));
  }

  /**
   * Convert tool schema to MCP definition
   */
  private static schemaToMCPDefinition(schema: ToolSchema): MCPToolDefinition {
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
   * Execute tool
   */
  static async executeTool(
    toolName: string,
    params: any,
    context: ToolExecutionContext
  ): Promise<any> {
    const tool = this.tools.get(toolName);
    
    if (!tool) {
      throw new Error(`Tool '${toolName}' not found`);
    }

    if (!tool.enabled) {
      throw new Error(`Tool '${toolName}' is disabled`);
    }

    loggingService.info('Executing tool', {
      toolName,
      integration: tool.schema.integration,
      userId: context.userId,
      httpMethod: tool.schema.httpMethod,
    });

    try {
      const result = await tool.handler(params, context);
      
      loggingService.info('Tool executed successfully', {
        toolName,
        integration: tool.schema.integration,
        userId: context.userId,
      });

      return result;
    } catch (error) {
      loggingService.error('Tool execution failed', {
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
  static setToolEnabled(toolName: string, enabled: boolean): boolean {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return false;
    }

    tool.enabled = enabled;
    
    loggingService.info('Tool enabled status changed', {
      toolName,
      enabled,
    });

    return true;
  }

  /**
   * Clear all tools (for testing)
   */
  static clear(): void {
    this.tools.clear();
    this.toolsByIntegration.clear();
    loggingService.debug('Tool registry cleared');
  }

  /**
   * Get registry stats
   */
  static getStats(): {
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
}
