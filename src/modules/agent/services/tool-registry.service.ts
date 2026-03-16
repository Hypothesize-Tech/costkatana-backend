import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface ToolDefinition {
  name: string;
  description: string;
  category: string;
  inputSchema: any;
  status: 'active' | 'inactive' | 'error';
  statusMessage?: string;
  metadata: {
    provider: string;
    version: string;
    lastSynced?: Date;
    [key: string]: any;
  };
}

export interface ToolSyncResult {
  success: boolean;
  toolsWritten: number;
  errors: Array<{ tool: string; error: string }>;
  directory: string;
}

/**
 * Tool Registry Service
 * Centralized service for managing tool definitions and file-based discovery
 * Ported from Express ToolRegistryService with NestJS patterns
 */
@Injectable()
export class ToolRegistryService implements OnModuleInit {
  private readonly logger = new Logger(ToolRegistryService.name);
  private readonly toolsDirectory = '/tmp/costkatana/tools';
  private readonly enableSync = true;
  private readonly toolCache: Map<string, ToolDefinition> = new Map();

  async onModuleInit(): Promise<void> {
    await this.initialize();
  }

  /**
   * Initialize the tool registry and ensure directories exist
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.toolsDirectory, { recursive: true });

      // Create category directories
      const categories = [
        'mongodb',
        'vercel',
        'analytics',
        'aws',
        'github',
        'google',
      ];
      for (const category of categories) {
        await fs.mkdir(path.join(this.toolsDirectory, category), {
          recursive: true,
        });
      }

      this.logger.log('Tool registry directories created', {
        directory: this.toolsDirectory,
        categories,
      });
    } catch (error: any) {
      this.logger.error('Failed to initialize tool registry', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Register a tool and sync to file
   */
  async registerTool(tool: ToolDefinition): Promise<void> {
    if (!this.enableSync) {
      this.toolCache.set(tool.name, tool);
      return;
    }

    try {
      const filePath = this.getToolFilePath(tool.category, tool.name);
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      const toolData = {
        ...tool,
        metadata: {
          ...tool.metadata,
          lastSynced: new Date(),
        },
      };

      await fs.writeFile(filePath, JSON.stringify(toolData, null, 2), 'utf-8');
      this.toolCache.set(tool.name, tool);

      this.logger.debug('Tool registered', {
        toolName: tool.name,
        category: tool.category,
        filePath,
      });
    } catch (error: any) {
      this.logger.error('Failed to register tool', {
        toolName: tool.name,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Register multiple tools in batch
   */
  async registerTools(tools: ToolDefinition[]): Promise<ToolSyncResult> {
    const errors: Array<{ tool: string; error: string }> = [];
    let toolsWritten = 0;

    for (const tool of tools) {
      try {
        await this.registerTool(tool);
        toolsWritten++;
      } catch (error: any) {
        errors.push({
          tool: tool.name,
          error: error.message,
        });
      }
    }

    return {
      success: errors.length === 0,
      toolsWritten,
      errors,
      directory: this.toolsDirectory,
    };
  }

  /**
   * Get tool definition from cache or file
   */
  async getTool(
    toolName: string,
    category?: string,
  ): Promise<ToolDefinition | null> {
    // Check cache first
    if (this.toolCache.has(toolName)) {
      const cached = this.toolCache.get(toolName);
      return cached || null;
    }

    if (!this.enableSync) {
      return null;
    }

    try {
      // Try to read from file
      let filePath: string;

      if (category) {
        filePath = this.getToolFilePath(category, toolName);
      } else {
        // Search all categories
        filePath = await this.findToolFile(toolName);
      }

      const content = await fs.readFile(filePath, 'utf-8');
      const tool: ToolDefinition = JSON.parse(content);
      this.toolCache.set(tool.name, tool);

      return tool;
    } catch (error: any) {
      this.logger.warn('Failed to get tool', {
        toolName,
        category,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * List tools by category
   */
  async listTools(category?: string): Promise<ToolDefinition[]> {
    try {
      const categories = category
        ? [category]
        : await fs.readdir(this.toolsDirectory);
      const tools: ToolDefinition[] = [];

      for (const cat of categories) {
        const categoryPath = path.join(this.toolsDirectory, cat);
        try {
          const stat = await fs.stat(categoryPath);
          if (!stat.isDirectory()) continue;

          const files = await fs.readdir(categoryPath);
          for (const file of files) {
            if (file.endsWith('.json')) {
              const content = await fs.readFile(
                path.join(categoryPath, file),
                'utf-8',
              );
              const tool: ToolDefinition = JSON.parse(content);
              tools.push(tool);
            }
          }
        } catch {
          continue;
        }
      }

      return tools;
    } catch (error: any) {
      this.logger.warn('Failed to list tools', {
        category,
        error: error.message,
      });
      return [];
    }
  }

  /**
   * List all tool names across all categories
   */
  async listAllToolNames(): Promise<string[]> {
    try {
      const categories = await fs.readdir(this.toolsDirectory);
      const toolNames: string[] = [];

      for (const category of categories) {
        const categoryPath = path.join(this.toolsDirectory, category);
        try {
          const stat = await fs.stat(categoryPath);
          if (!stat.isDirectory()) continue;

          const files = await fs.readdir(categoryPath);
          for (const file of files) {
            if (file.endsWith('.json')) {
              toolNames.push(path.basename(file, '.json'));
            }
          }
        } catch {
          continue;
        }
      }

      return toolNames;
    } catch (error: any) {
      this.logger.error('Failed to list all tool names', {
        error: error.message,
      });
      return [];
    }
  }

  /**
   * Update tool status
   */
  async updateToolStatus(
    toolName: string,
    status: ToolDefinition['status'],
    message?: string,
  ): Promise<void> {
    const tool = await this.getTool(toolName);
    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    tool.status = status;
    tool.statusMessage = message;

    await this.registerTool(tool);

    this.logger.log('Tool status updated', {
      toolName,
      status,
      message,
    });
  }

  /**
   * Get tools directory path
   */
  getToolsDirectory(): string {
    return this.toolsDirectory;
  }

  /**
   * Get tool file path
   */
  getToolFilePath(category: string, toolName: string): string {
    return path.join(this.toolsDirectory, category, `${toolName}.json`);
  }

  /**
   * Find tool file across all categories
   */
  private async findToolFile(toolName: string): Promise<string> {
    const categories = await fs.readdir(this.toolsDirectory);

    for (const category of categories) {
      const filePath = this.getToolFilePath(category, toolName);
      try {
        await fs.access(filePath);
        return filePath;
      } catch {
        continue;
      }
    }

    throw new Error(`Tool file not found: ${toolName}`);
  }

  /**
   * Clear tool cache
   */
  clearCache(): void {
    this.toolCache.clear();
    this.logger.log('Tool cache cleared');
  }

  /**
   * Get tool registry statistics
   */
  async getStatistics(): Promise<{
    totalTools: number;
    toolsByCategory: Record<string, number>;
    cacheSize: number;
  }> {
    const categories = await fs.readdir(this.toolsDirectory);
    const toolsByCategory: Record<string, number> = {};
    let totalTools = 0;

    for (const category of categories) {
      const categoryPath = path.join(this.toolsDirectory, category);
      try {
        const stat = await fs.stat(categoryPath);
        if (stat.isDirectory()) {
          const files = await fs.readdir(categoryPath);
          const jsonFiles = files.filter((f) => f.endsWith('.json'));
          toolsByCategory[category] = jsonFiles.length;
          totalTools += jsonFiles.length;
        }
      } catch {
        continue;
      }
    }

    return {
      totalTools,
      toolsByCategory,
      cacheSize: this.toolCache.size,
    };
  }
}
