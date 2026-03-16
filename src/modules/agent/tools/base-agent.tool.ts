import { Tool } from '@langchain/core/tools';
import { Injectable, Logger } from '@nestjs/common';

/**
 * Base Agent Tool
 * All agent tools extend this base class which provides common functionality.
 * Uses protected _name/_description to satisfy LangChain's abstract name/description
 * without assigning to abstract properties in the constructor.
 */
@Injectable()
export abstract class BaseAgentTool extends Tool {
  protected readonly logger: Logger;
  protected _name: string;
  protected _description: string;

  get name(): string {
    return this._name;
  }

  get description(): string {
    return this._description;
  }

  constructor(name: string, description: string) {
    super();
    this._name = name;
    this._description = description;
    this.logger = new Logger(`${BaseAgentTool.name}:${name}`);
  }

  /**
   * Override this method to implement the tool's logic
   */
  protected abstract executeLogic(input: any): Promise<any>;

  /**
   * Execute the tool with error handling and logging
   */
  async _call(input: string): Promise<string> {
    try {
      this.logger.debug(`Executing tool: ${this.name}`, {
        input: input.substring(0, 100),
      });

      const parsedInput = this.parseInput(input);
      const result = await this.executeLogic(parsedInput);

      this.logger.debug(`Tool execution completed: ${this.name}`, {
        success: true,
        hasResult: !!result,
      });

      return JSON.stringify(result);
    } catch (error: any) {
      this.logger.error(`Tool execution failed: ${this.name}`, {
        error: error.message,
        input: input.substring(0, 100),
      });

      return JSON.stringify({
        success: false,
        operation: this.name,
        error: error.message,
      });
    }
  }

  /**
   * Parse input string to structured data
   */
  private parseInput(input: string): any {
    try {
      // Try to parse as JSON first
      return JSON.parse(input);
    } catch {
      // If not JSON, return as string
      return { query: input };
    }
  }

  /**
   * Create a standardized success response
   */
  protected createSuccessResponse(operation: string, data: any): any {
    return {
      success: true,
      operation,
      data,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Create a standardized error response
   */
  protected createErrorResponse(operation: string, error: string): any {
    return {
      success: false,
      operation,
      error,
      timestamp: new Date().toISOString(),
    };
  }
}
