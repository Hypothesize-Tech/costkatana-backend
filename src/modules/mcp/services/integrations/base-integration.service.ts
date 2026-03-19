/**
 * Base Integration Service for MCP
 * Abstract base class for all integration MCP services
 */

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import axios, { AxiosResponse } from 'axios';
import { LoggerService } from '@/common/logger/logger.service';
import { EncryptionService } from '@/utils/encryption';
import { ToolRegistryService } from '../tool-registry.service';
import { TokenManagerService } from '../token-manager.service';
import {
  IntegrationType,
  ToolSchema,
  ToolExecutionContext,
  ToolHandler,
} from '../../types/mcp.types';
import {
  createSuccessResponse,
  createErrorResponse,
} from '../../utils/standard-response';
import { createMCPError } from '../../utils/error-mapper';
import { VercelConnection } from '@/schemas/integration/vercel-connection.schema';
import { GitHubConnection } from '@/schemas/integration/github-connection.schema';
import { GoogleConnection } from '@/schemas/integration/google-connection.schema';
import { MongoDBConnection } from '@/schemas/integration/mongodb-connection.schema';
import { AWSConnection } from '@/schemas/integration/aws-connection.schema';
import { Integration } from '@/schemas/integration/integration.schema';

@Injectable()
export abstract class BaseIntegrationService {
  protected abstract integration: IntegrationType;
  protected abstract version: string;

  constructor(
    protected logger: LoggerService,
    protected toolRegistry: ToolRegistryService,
    protected tokenManager: TokenManagerService,
    @InjectModel(VercelConnection.name)
    protected vercelConnectionModel: Model<VercelConnection>,
    @InjectModel(GitHubConnection.name)
    protected githubConnectionModel: Model<GitHubConnection>,
    @InjectModel(GoogleConnection.name)
    protected googleConnectionModel: Model<GoogleConnection>,
    @InjectModel(MongoDBConnection.name)
    protected mongodbConnectionModel: Model<MongoDBConnection>,
    @InjectModel(AWSConnection.name)
    protected awsConnectionModel: Model<AWSConnection>,
    @InjectModel(Integration.name)
    protected integrationModel: Model<Integration>,
  ) {
    // Initialize any integration-specific setup if needed
    this.initializeIntegration();
  }

  /**
   * Initialize and register all tools
   */
  abstract registerTools(): void;

  /**
   * Initialize integration-specific setup
   */
  protected initializeIntegration(): void {
    // Default implementation - subclasses can override for specific initialization
    this.logger.debug(`Initializing ${this.integration} integration`);
  }

  /**
   * Resolve connection ID for a user and this integration.
   * Used by executeNaturalLanguageCommand to build execution context.
   */
  protected async getConnectionIdForUser(
    userId: string,
  ): Promise<string | null> {
    try {
      switch (this.integration) {
        case 'vercel': {
          const conn = await this.vercelConnectionModel
            .findOne({ userId, isActive: true })
            .select('_id')
            .lean();
          return conn?._id?.toString() ?? null;
        }
        case 'github': {
          const conn = await this.githubConnectionModel
            .findOne({ userId, isActive: true })
            .select('_id')
            .lean();
          return conn?._id?.toString() ?? null;
        }
        case 'google': {
          const conn = await this.googleConnectionModel
            .findOne({ userId, isActive: true })
            .select('_id')
            .lean();
          return conn?._id?.toString() ?? null;
        }
        case 'mongodb': {
          const conn = await this.mongodbConnectionModel
            .findOne({ userId, isActive: true })
            .select('_id')
            .lean();
          return conn?._id?.toString() ?? null;
        }
        case 'aws': {
          const conn = await this.awsConnectionModel
            .findOne({ userId, status: 'active' })
            .select('_id')
            .lean();
          return conn?._id?.toString() ?? null;
        }
        default: {
          const typePattern = new RegExp(this.integration, 'i');
          const conn = await this.integrationModel
            .findOne({
              userId,
              status: 'active',
              type: typePattern,
            })
            .select('_id')
            .lean();
          return conn?._id?.toString() ?? null;
        }
      }
    } catch (error) {
      this.logger.error('Failed to get connection for user', {
        integration: this.integration,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Execute a natural language command (used by governed-agent orchestration).
   * Resolves the user's connection, builds execution context, then delegates to
   * parseAndExecuteNaturalLanguageCommand. Subclasses may override that method
   * to map commands to tool calls; default returns a not-implemented response.
   */
  async executeNaturalLanguageCommand(
    userId: string,
    command: string,
  ): Promise<any> {
    const connectionId = await this.getConnectionIdForUser(userId);
    if (!connectionId) {
      this.logger.warn('No active connection for natural language command', {
        integration: this.integration,
        userId,
        commandPreview: command.substring(0, 80),
      });
      return {
        success: false,
        message: `No active ${this.integration} connection found for user. Please connect your ${this.integration} account first.`,
        connectionRequired: true,
      };
    }

    const context: ToolExecutionContext = {
      userId,
      connectionId,
      integration: this.integration,
      permissions: [],
      scopes: [],
      isAdmin: false,
    };
    return this.parseAndExecuteNaturalLanguageCommand(command, context);
  }

  /**
   * Parse a natural language command and execute via tool registry.
   * Override in subclasses to map commands to (toolName, params) and call
   * this.toolRegistry.executeTool(toolName, params, context).
   * Default returns a not-implemented response so callers get a consistent shape.
   */
  protected async parseAndExecuteNaturalLanguageCommand(
    command: string,
    context: ToolExecutionContext,
  ): Promise<any> {
    try {
      // Get available tools for this integration
      const availableTools = this.toolRegistry.getToolsForIntegration(
        this.integration,
      );

      // Use AI to parse the natural language command and map to tools
      const parsingPrompt = `Parse this natural language command and map it to available tools:

Integration: ${this.integration}
Command: "${command}"

Available tools: ${availableTools.map((t) => t.schema.name).join(', ')}

Tool schemas:
${availableTools.map((t) => JSON.stringify(t.schema, null, 2)).join('\n\n')}

Respond with JSON:
{
  "tool": "tool_name",
  "parameters": { "param1": "value1", ... },
  "confidence": 0.8,
  "reasoning": "why this tool was selected"
}`;

      const aiResponse = await this.callAIForCommandParsing(parsingPrompt);

      if (!aiResponse || !aiResponse.tool) {
        return {
          success: false,
          message:
            'Could not parse command. Please use specific tool names instead.',
          availableTools: availableTools.map((t) => t.schema.name),
        };
      }

      // Find the tool
      const selectedTool = availableTools.find(
        (t) => t.schema.name === aiResponse.tool,
      );
      if (!selectedTool) {
        return {
          success: false,
          message: `Tool '${aiResponse.tool}' not found. Available tools: ${availableTools.map((t) => t.schema.name).join(', ')}`,
        };
      }

      // Execute the tool
      const result = await selectedTool.handler(
        aiResponse.parameters || {},
        context,
      );

      return {
        success: true,
        tool: aiResponse.tool,
        parameters: aiResponse.parameters,
        confidence: aiResponse.confidence || 0.5,
        result,
      };
    } catch (error) {
      this.logger.error('Error executing natural language command', {
        integration: this.integration,
        userId: context.userId,
        command: command.substring(0, 100),
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        message:
          'Failed to execute natural language command. Please try using specific tools instead.',
        availableTools: this.toolRegistry
          .getToolsForIntegration(this.integration)
          .map((t) => t.schema.name),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Call AI service for command parsing
   */
  protected async callAIForCommandParsing(prompt: string): Promise<any> {
    try {
      // Get available tools for context
      const availableTools = this.toolRegistry.getToolsForIntegration(
        this.integration,
      );

      if (availableTools.length === 0) {
        return null;
      }

      // Create AI parsing prompt
      const parsingPrompt = `Parse this natural language command and map it to the available tools:

INTEGRATION: ${this.integration}
COMMAND: ${prompt}

AVAILABLE TOOLS:
${availableTools.map((tool, index) => `${index + 1}. ${tool.schema.name}: ${tool.schema.description}`).join('\n')}

TOOL SCHEMAS:
${availableTools
  .map(
    (tool) => `TOOL: ${tool.schema.name}
${JSON.stringify(tool.schema.parameters || {}, null, 2)}`,
  )
  .join('\n\n')}

RESPONSE FORMAT:
Return a JSON object with:
{
  "tool": "exact_tool_name",
  "parameters": { "param": "value" },
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}

If no suitable tool is found, return: {"error": "no_suitable_tool"}`;

      // Use Bedrock service for AI parsing
      const { BedrockService } =
        await import('../../../../services/bedrock.service');
      const aiResponse = await BedrockService.invokeModel(
        parsingPrompt,
        'amazon.nova-lite-v1:0',
        { useSystemPrompt: false },
      );

      // Parse AI response
      try {
        const parsed = JSON.parse(
          typeof aiResponse === 'string'
            ? aiResponse
            : ((aiResponse as { response?: string })?.response ?? '{}'),
        );

        if (parsed.error === 'no_suitable_tool') {
          return null;
        }

        // Validate that the tool exists
        const toolExists = availableTools.some(
          (tool) => tool.schema.name === parsed.tool,
        );
        if (!toolExists) {
          this.logger.warn(`AI suggested non-existent tool: ${parsed.tool}`);
          return null;
        }

        return {
          tool: parsed.tool,
          parameters: parsed.parameters || {},
          confidence: parsed.confidence || 0.5,
          reasoning: parsed.reasoning || 'AI-parsed command',
        };
      } catch (parseError) {
        this.logger.warn(
          'Failed to parse AI response, using fallback',
          parseError,
        );
        return this.fallbackCommandParsing(prompt);
      }
    } catch (error) {
      this.logger.error('AI command parsing failed, using fallback', {
        integration: this.integration,
        prompt: prompt.substring(0, 100),
        error: error instanceof Error ? error.message : String(error),
      });
      return this.fallbackCommandParsing(prompt);
    }
  }

  /**
   * Fallback command parsing using keyword matching
   */
  private fallbackCommandParsing(prompt: string): any {
    const availableTools = this.toolRegistry.getToolsForIntegration(
      this.integration,
    );
    const command = prompt.toLowerCase();

    // Enhanced keyword matching
    const keywordMappings: Record<string, string[]> = {
      // Common action keywords mapped to tools
      find: ['find', 'search', 'get', 'retrieve', 'query'],
      create: ['create', 'add', 'new', 'insert'],
      update: ['update', 'modify', 'change', 'edit'],
      delete: ['delete', 'remove', 'destroy'],
      list: ['list', 'show', 'display', 'view'],
      connect: ['connect', 'link', 'associate'],
      disconnect: ['disconnect', 'unlink', 'separate'],
    };

    for (const tool of availableTools) {
      const toolName = tool.schema.name.toLowerCase();

      // Direct tool name match
      if (command.includes(toolName)) {
        return {
          tool: tool.schema.name,
          parameters: this.extractParametersFromPrompt(prompt, tool),
          confidence: 0.7,
          reasoning: `Direct tool name match: '${toolName}'`,
        };
      }

      // Keyword-based matching
      for (const [action, keywords] of Object.entries(keywordMappings)) {
        if (
          keywords.some((keyword) => command.includes(keyword)) &&
          toolName.includes(action)
        ) {
          return {
            tool: tool.schema.name,
            parameters: this.extractParametersFromPrompt(prompt, tool),
            confidence: 0.5,
            reasoning: `Keyword match: '${action}' -> '${toolName}'`,
          };
        }
      }
    }

    return null;
  }

  /**
   * Extract parameters from natural language prompt with advanced parsing
   */
  private extractParametersFromPrompt(
    prompt: string,
    tool: any,
  ): Record<string, any> {
    const parameters: Record<string, any> = {};

    if (!tool.schema.parameters || !tool.schema.parameters.properties) {
      return parameters;
    }

    const paramDefs = tool.schema.parameters.properties;
    const lowerPrompt = prompt.toLowerCase();
    const originalPrompt = prompt;

    // Extract parameters based on their types and definitions
    for (const [paramName, paramDef] of Object.entries(paramDefs)) {
      if (typeof paramDef !== 'object') continue;

      const paramSchema = paramDef as any;
      const extractedValue = this.extractParameterValue(
        paramName,
        paramSchema,
        lowerPrompt,
        originalPrompt,
      );

      if (extractedValue !== undefined) {
        parameters[paramName] = extractedValue;
      } else if (paramSchema.default !== undefined) {
        // Use default value if extraction failed but default exists
        parameters[paramName] = paramSchema.default;
      }
    }

    return parameters;
  }

  /**
   * Extract a single parameter value based on its schema
   */
  private extractParameterValue(
    paramName: string,
    paramSchema: any,
    lowerPrompt: string,
    originalPrompt: string,
  ): any {
    const paramType = paramSchema.type;
    const paramNameLower = paramName.toLowerCase();

    // Build extraction patterns for this parameter
    const patterns = this.buildExtractionPatterns(paramName, paramNameLower);

    switch (paramType) {
      case 'string':
        return this.extractStringParameter(
          paramNameLower,
          paramSchema,
          patterns,
          originalPrompt,
        );

      case 'number':
      case 'integer':
        return this.extractNumericParameter(
          paramNameLower,
          paramSchema,
          patterns,
          lowerPrompt,
        );

      case 'boolean':
        return this.extractBooleanParameter(
          paramNameLower,
          paramSchema,
          patterns,
          lowerPrompt,
        );

      case 'array':
        return this.extractArrayParameter(
          paramNameLower,
          paramSchema,
          patterns,
          originalPrompt,
        );

      case 'object':
        return this.extractObjectParameter(
          paramNameLower,
          paramSchema,
          patterns,
          originalPrompt,
        );

      default:
        // Try generic string extraction for unknown types
        return this.extractStringParameter(
          paramNameLower,
          paramSchema,
          patterns,
          originalPrompt,
        );
    }
  }

  /**
   * Build common extraction patterns for a parameter
   */
  private buildExtractionPatterns(
    paramName: string,
    paramNameLower: string,
  ): RegExp[] {
    return [
      // Direct assignment: param=value or param: value or param = value
      new RegExp(`${paramNameLower}\\s*[:=]\\s*["']([^"']+)["']`, 'i'),
      new RegExp(`${paramNameLower}\\s*[:=]\\s*([^{},\\n]+)`, 'i'),

      // Named parameter: using "param" or "param name"
      new RegExp(
        `(?:${paramNameLower}|${paramName.replace(/([A-Z])/g, ' $1').toLowerCase()})\\s+["']([^"']+)["']`,
        'i',
      ),
      new RegExp(
        `(?:${paramNameLower}|${paramName.replace(/([A-Z])/g, ' $1').toLowerCase()})\\s+([^{},\\n]+)`,
        'i',
      ),

      // Contextual patterns
      new RegExp(`with\\s+${paramNameLower}\\s+["']([^"']+)["']`, 'i'),
      new RegExp(`set\\s+${paramNameLower}\\s+to\\s+["']([^"']+)["']`, 'i'),
      new RegExp(`${paramNameLower}\\s+should\\s+be\\s+["']([^"']+)["']`, 'i'),
    ];
  }

  /**
   * Extract string parameter value
   */
  private extractStringParameter(
    paramNameLower: string,
    paramSchema: any,
    patterns: RegExp[],
    originalPrompt: string,
  ): string | undefined {
    for (const pattern of patterns) {
      const match = originalPrompt.match(pattern);
      if (match && match[1]) {
        let value = match[1].trim();

        // Apply string constraints
        if (paramSchema.minLength && value.length < paramSchema.minLength) {
          continue; // Too short
        }
        if (paramSchema.maxLength && value.length > paramSchema.maxLength) {
          value = value.substring(0, paramSchema.maxLength);
        }
        if (
          paramSchema.pattern &&
          !new RegExp(paramSchema.pattern).test(value)
        ) {
          continue; // Doesn't match pattern
        }
        if (paramSchema.enum && !paramSchema.enum.includes(value)) {
          continue; // Not in allowed values
        }

        return value;
      }
    }
    return undefined;
  }

  /**
   * Extract numeric parameter value
   */
  private extractNumericParameter(
    paramNameLower: string,
    paramSchema: any,
    patterns: RegExp[],
    lowerPrompt: string,
  ): number | undefined {
    // Look for numeric values near the parameter name
    const numberPatterns = [
      new RegExp(`${paramNameLower}\\s*[:=]\\s*(-?\\d+(?:\\.\\d+)?)`, 'i'),
      new RegExp(`${paramNameLower}\\s+(-?\\d+(?:\\.\\d+)?)`, 'i'),
      new RegExp(`(-?\\d+(?:\\.\\d+)?)\\s+${paramNameLower}`, 'i'),
    ];

    for (const pattern of numberPatterns) {
      const match = lowerPrompt.match(pattern);
      if (match && match[1]) {
        const numValue =
          paramSchema.type === 'integer'
            ? parseInt(match[1], 10)
            : parseFloat(match[1]);

        // Apply numeric constraints
        if (
          paramSchema.minimum !== undefined &&
          numValue < paramSchema.minimum
        ) {
          continue;
        }
        if (
          paramSchema.maximum !== undefined &&
          numValue > paramSchema.maximum
        ) {
          continue;
        }
        if (paramSchema.multipleOf && numValue % paramSchema.multipleOf !== 0) {
          continue;
        }

        return numValue;
      }
    }
    return undefined;
  }

  /**
   * Extract boolean parameter value
   */
  private extractBooleanParameter(
    paramNameLower: string,
    paramSchema: any,
    patterns: RegExp[],
    lowerPrompt: string,
  ): boolean | undefined {
    // Look for boolean indicators
    const booleanPatterns = [
      new RegExp(`${paramNameLower}\\s*[:=]\\s*(true|yes|on|enable|1)`, 'i'),
      new RegExp(`${paramNameLower}\\s*[:=]\\s*(false|no|off|disable|0)`, 'i'),
      new RegExp(`(?:enable|turn\\s+on)\\s+${paramNameLower}`, 'i'),
      new RegExp(`(?:disable|turn\\s+off)\\s+${paramNameLower}`, 'i'),
    ];

    for (const pattern of booleanPatterns) {
      const match = lowerPrompt.match(pattern);
      if (match) {
        const indicator = match[1]?.toLowerCase();
        if (indicator) {
          return ['true', 'yes', 'on', 'enable', '1'].includes(indicator);
        } else {
          // Pattern matched without capture group (enable/disable patterns)
          return (
            pattern.source.includes('enable') ||
            pattern.source.includes('turn\\s+on')
          );
        }
      }
    }
    return undefined;
  }

  /**
   * Extract array parameter value
   */
  private extractArrayParameter(
    paramNameLower: string,
    paramSchema: any,
    patterns: RegExp[],
    originalPrompt: string,
  ): any[] | undefined {
    // Look for comma-separated values or JSON-like arrays
    const arrayPatterns = [
      new RegExp(`${paramNameLower}\\s*[:=]\\s*\\[([^\\]]+)\\]`, 'i'), // [item1, item2]
      new RegExp(
        `${paramNameLower}\\s*[:=]\\s*([^{},\\n]+(?:,[^{},\\n]+)+)`,
        'i',
      ), // item1, item2
    ];

    for (const pattern of arrayPatterns) {
      const match = originalPrompt.match(pattern);
      if (match && match[1]) {
        try {
          // Try to parse as JSON array first
          if (match[1].trim().startsWith('[')) {
            return JSON.parse(match[1]);
          }

          // Parse as comma-separated values
          const items = match[1].split(',').map((item) => {
            const trimmed = item.trim();
            // Try to parse as number or boolean, otherwise keep as string
            if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
              return trimmed.includes('.')
                ? parseFloat(trimmed)
                : parseInt(trimmed, 10);
            }
            if (/^(true|false)$/i.test(trimmed)) {
              return trimmed.toLowerCase() === 'true';
            }
            // Remove quotes if present
            return trimmed.replace(/^["']|["']$/g, '');
          });

          // Apply array constraints
          if (paramSchema.minItems && items.length < paramSchema.minItems) {
            continue;
          }
          if (paramSchema.maxItems && items.length > paramSchema.maxItems) {
            items.splice(paramSchema.maxItems);
          }

          return items;
        } catch (error) {
          // Parsing failed, continue to next pattern
          continue;
        }
      }
    }
    return undefined;
  }

  /**
   * Extract object parameter value
   */
  private extractObjectParameter(
    paramNameLower: string,
    paramSchema: any,
    patterns: RegExp[],
    originalPrompt: string,
  ): Record<string, any> | undefined {
    // Look for JSON-like object syntax
    const objectPatterns = [
      new RegExp(`${paramNameLower}\\s*[:=]\\s*(\\{[^}]+\\})`, 'i'), // {key: value}
    ];

    for (const pattern of objectPatterns) {
      const match = originalPrompt.match(pattern);
      if (match && match[1]) {
        try {
          const parsedObject = JSON.parse(match[1]);

          // Validate against schema if properties are defined
          if (paramSchema.properties) {
            const validatedObject: Record<string, any> = {};

            for (const [key, schema] of Object.entries(
              paramSchema.properties,
            )) {
              if (parsedObject[key] !== undefined) {
                // Basic validation - could be enhanced
                validatedObject[key] = parsedObject[key];
              }
            }

            return validatedObject;
          }

          return parsedObject;
        } catch (error) {
          // JSON parsing failed, continue
          continue;
        }
      }
    }
    return undefined;
  }

  /**
   * Helper to register a tool with permission validation wrapper
   */
  protected registerTool(
    schema: ToolSchema,
    handler: (params: any, context: ToolExecutionContext) => Promise<any>,
    options?: {
      enabled?: boolean;
      priority?: number;
      rateLimitOverride?: number;
    },
  ): void {
    const wrappedHandler: ToolHandler = async (params, context) => {
      const startTime = Date.now();

      try {
        // Call the actual handler
        const result = await handler(params, context);

        // Wrap in standard response
        return createSuccessResponse(result, {
          integration: schema.integration,
          operation: schema.name,
          latency: Date.now() - startTime,
          httpMethod: schema.httpMethod,
          permissionChecked: true,
          dangerousOperation: schema.dangerous,
          userId: context.userId,
          connectionId: context.connectionId,
        });
      } catch (error) {
        this.logger.error('Tool handler error', {
          error: error instanceof Error ? error.message : String(error),
          toolName: schema.name,
          integration: schema.integration,
        });

        return createErrorResponse(createMCPError(error), {
          integration: schema.integration,
          operation: schema.name,
          latency: Date.now() - startTime,
          httpMethod: schema.httpMethod,
          permissionChecked: true,
          dangerousOperation: schema.dangerous,
        });
      }
    };

    this.toolRegistry.registerTool(schema, wrappedHandler, {
      enabled: options?.enabled ?? true,
      rateLimitOverride: options?.rateLimitOverride,
    });

    this.logger.debug('Tool registered', {
      name: schema.name,
      integration: schema.integration,
      httpMethod: schema.httpMethod,
      enabled: options?.enabled ?? true,
      priority: options?.priority ?? 0,
    });
  }

  /**
   * Get connection access token by calling the model's decryptToken method
   */
  protected async getAccessToken(connectionId: string): Promise<string> {
    try {
      switch (this.integration) {
        case 'vercel': {
          const connection = await this.vercelConnectionModel
            .findById(connectionId)
            .select('+encryptedAccessToken');
          if (!connection) {
            throw new Error(
              `Vercel connection not found for ID: ${connectionId}`,
            );
          }
          if (!connection.isActive) {
            throw new Error(`Vercel connection is not active`);
          }
          const encrypted = connection.encryptedAccessToken;
          if (typeof encrypted !== 'string') {
            throw new Error('Vercel connection has no access token');
          }
          return EncryptionService.decryptFromCombinedFormat(encrypted);
        }

        case 'github': {
          const connection = await this.githubConnectionModel
            .findById(connectionId)
            .select('+accessToken');
          if (!connection) {
            throw new Error(
              `GitHub connection not found for ID: ${connectionId}`,
            );
          }
          if (!connection.isActive) {
            throw new Error(`GitHub connection is not active`);
          }
          return connection.decryptToken();
        }

        case 'google': {
          const connection = await this.googleConnectionModel
            .findById(connectionId)
            .select('+encryptedAccessToken');
          if (!connection) {
            throw new Error(
              `Google connection not found for ID: ${connectionId}`,
            );
          }
          if (!connection.isActive) {
            throw new Error(`Google connection is not active`);
          }
          const encrypted = connection.encryptedAccessToken;
          if (typeof encrypted !== 'string') {
            throw new Error('Google connection has no access token');
          }
          return EncryptionService.decryptFromCombinedFormat(encrypted);
        }

        case 'mongodb': {
          const connection = await this.mongodbConnectionModel
            .findById(connectionId)
            .select('+encryptedConnectionString');
          if (!connection) {
            throw new Error(
              `MongoDB connection not found for ID: ${connectionId}`,
            );
          }
          if (!connection.isActive) {
            throw new Error(`MongoDB connection is not active`);
          }
          const encrypted = connection.encryptedConnectionString;
          if (typeof encrypted !== 'string') {
            throw new Error('MongoDB connection has no connection string');
          }
          return EncryptionService.decryptFromCombinedFormat(encrypted);
        }

        case 'aws': {
          const connection =
            await this.awsConnectionModel.findById(connectionId);
          if (!connection) {
            throw new Error(`AWS connection not found for ID: ${connectionId}`);
          }
          if (connection.status !== 'active') {
            throw new Error(`AWS connection is not active`);
          }
          // AWS uses IAM roles - return role ARN for STS AssumeRole
          return connection.roleArn;
        }

        default: {
          // For generic integrations (Slack, Discord, Jira, Linear)
          const connection = await this.integrationModel.findById(connectionId);
          if (!connection) {
            throw new Error(
              `${this.integration} connection not found for ID: ${connectionId}`,
            );
          }
          if (connection.status !== 'active') {
            throw new Error(`${this.integration} connection is not active`);
          }
          // Generic integrations use getCredentials() method
          const credentials = connection.getCredentials();
          return credentials?.accessToken || '';
        }
      }
    } catch (error) {
      this.logger.error('Failed to get access token', {
        integration: this.integration,
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Make authenticated HTTP request with automatic token refresh
   */
  protected async makeRequest(
    connectionId: string,
    method: string,
    url: string,
    options: {
      body?: any;
      headers?: Record<string, string>;
      params?: Record<string, any>;
      timeout?: number;
      maxRetries?: number;
    } = {},
  ): Promise<any> {
    // Check and refresh token if needed (before first request)
    if (
      this.integration === 'google' ||
      this.integration === 'github' ||
      this.integration === 'jira' ||
      this.integration === 'linear' ||
      this.integration === 'slack' ||
      this.integration === 'discord'
    ) {
      try {
        await this.tokenManager.refreshIfNeeded(connectionId, this.integration);
      } catch (refreshError) {
        this.logger.warn(
          'Token refresh check failed, proceeding with existing token',
          {
            integration: this.integration,
            connectionId,
            error:
              refreshError instanceof Error
                ? refreshError.message
                : String(refreshError),
          },
        );
      }
    }

    const accessToken = await this.getAccessToken(connectionId);

    const config: any = {
      method,
      url,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...options.headers,
      },
      timeout: options.timeout || 300000, // 5 minute timeout by default
      validateStatus: (status: number) => status >= 200 && status < 300, // Only accept 2xx
    };

    if (options.body) {
      config.data = options.body;
    }

    if (options.params) {
      config.params = options.params;
    }

    // Retry logic
    const maxRetries = options.maxRetries || 2;
    let lastError: any;
    let tokenRefreshed = false;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        this.logger.log(
          `MCP HTTP request attempt ${attempt + 1}/${maxRetries + 1}`,
          {
            integration: this.integration,
            method,
            url: url.replace(/\?.*/, ''), // Remove query params from log
          },
        );

        const response: AxiosResponse = await axios(config);

        this.logger.log('MCP HTTP request successful', {
          integration: this.integration,
          method,
          url: url.replace(/\?.*/, ''),
          status: response.status,
          attempt: attempt + 1,
        });

        return response.data;
      } catch (error: any) {
        lastError = error;

        // Check if it's a 401 Unauthorized error - attempt token refresh once
        const is401 = error.response?.status === 401;
        const isRetryable =
          error.code === 'ECONNABORTED' || // Timeout
          error.code === 'ETIMEDOUT' ||
          error.code === 'ECONNRESET' ||
          (error.response?.status >= 500 && error.response?.status < 600); // Server errors

        this.logger.error(
          `MCP HTTP request failed (attempt ${attempt + 1}/${maxRetries + 1})`,
          {
            error: error.message,
            code: error.code,
            status: error.response?.status,
            statusText: error.response?.statusText,
            integration: this.integration,
            method,
            url: url.replace(/\?.*/, ''),
            isRetryable,
            is401,
            tokenRefreshed,
          },
        );

        // If 401 and we haven't tried refreshing token yet, attempt to refresh
        if (
          is401 &&
          !tokenRefreshed &&
          (this.integration === 'google' ||
            this.integration === 'github' ||
            this.integration === 'jira' ||
            this.integration === 'linear' ||
            this.integration === 'slack' ||
            this.integration === 'discord')
        ) {
          try {
            this.logger.log('Attempting to refresh token due to 401 error', {
              integration: this.integration,
              connectionId,
            });

            const refreshed = await this.tokenManager.refreshIfNeeded(
              connectionId,
              this.integration,
            );

            if (refreshed) {
              // Get the new access token
              const newAccessToken = await this.getAccessToken(connectionId);
              config.headers.Authorization = `Bearer ${newAccessToken}`;
              tokenRefreshed = true;

              this.logger.log(
                'Token refreshed successfully, retrying request',
                {
                  integration: this.integration,
                },
              );

              // Retry immediately with new token (don't count against retry limit)
              continue;
            } else {
              this.logger.warn(
                'Token refresh returned false, connection may need manual re-authorization',
                {
                  integration: this.integration,
                  connectionId,
                },
              );
            }
          } catch (refreshError) {
            this.logger.error('Token refresh failed', {
              integration: this.integration,
              connectionId,
              error:
                refreshError instanceof Error
                  ? refreshError.message
                  : String(refreshError),
            });
          }
        }

        // Handle 410 Gone - resource no longer exists (e.g., JIRA workspace deleted)
        if (error.response?.status === 410) {
          this.logger.error(
            `${this.integration} resource no longer exists (410 Gone)`,
            {
              integration: this.integration,
              connectionId,
              url: url.replace(/\?.*/, ''),
            },
          );
          throw new Error(
            `${this.integration.toUpperCase()} workspace or resource no longer exists. Please reconnect your ${this.integration.toUpperCase()} account from the integrations page.`,
          );
        }

        // Don't retry on last attempt or non-retryable errors (unless it's a 401 we just refreshed)
        if (attempt === maxRetries || (!isRetryable && !is401)) {
          break;
        }

        // Exponential backoff: 1s, 2s, 4s
        const backoffMs = Math.pow(2, attempt) * 1000;
        this.logger.log(`Retrying after ${backoffMs}ms...`, {
          integration: this.integration,
          attempt: attempt + 1,
        });
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    // All retries failed, throw the last error
    throw new Error(
      `${this.integration} API request failed: ${lastError.message} (status: ${lastError.response?.status || 'none'})`,
    );
  }
}
