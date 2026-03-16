import { Injectable } from '@nestjs/common';
import { BaseAgentTool } from './base-agent.tool';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * File System Tool Service
 * Read, write, and search files in the context directory
 * Ported from Express FileSystemTool with NestJS patterns
 */
@Injectable()
export class FileSystemToolService extends BaseAgentTool {
  private readonly contextDir = process.cwd(); // Current working directory

  constructor() {
    super(
      'file_system',
      `Access the file system to read, write, and search files:
- read: Read file contents
- write: Write content to files
- search: Search for files or content
- list: List directory contents

Input should be a JSON string with:
{
  "operation": "read|write|search|list",
  "path": "relative/path/to/file",
  "content": "content to write", // For write operations
  "pattern": "search pattern" // For search operations
}`,
    );
  }

  protected async executeLogic(input: any): Promise<any> {
    try {
      const { operation, path: filePath, content, pattern } = input;

      // Security: Ensure path is within context directory
      const fullPath = path.resolve(this.contextDir, filePath || '');
      if (!fullPath.startsWith(this.contextDir)) {
        return this.createErrorResponse(
          'file_system',
          'Access denied: Path outside context directory',
        );
      }

      switch (operation) {
        case 'read':
          return await this.readFile(fullPath);

        case 'write':
          return await this.writeFile(fullPath, content);

        case 'search':
          return await this.searchFiles(pattern, fullPath);

        case 'list':
          return await this.listDirectory(fullPath);

        default:
          return this.createErrorResponse(
            'file_system',
            `Unsupported operation: ${operation}`,
          );
      }
    } catch (error: any) {
      this.logger.error('File system operation failed', {
        error: error.message,
        input,
      });
      return this.createErrorResponse('file_system', error.message);
    }
  }

  private async readFile(filePath: string): Promise<any> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const stats = await fs.stat(filePath);

      return this.createSuccessResponse('file_system', {
        operation: 'read',
        path: path.relative(this.contextDir, filePath),
        content,
        size: stats.size,
        modified: stats.mtime,
        message: `Successfully read file (${stats.size} bytes)`,
      });
    } catch (error: any) {
      return this.createErrorResponse(
        'file_system',
        `Failed to read file: ${error.message}`,
      );
    }
  }

  private async writeFile(filePath: string, content: string): Promise<any> {
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, 'utf-8');
      const stats = await fs.stat(filePath);

      return this.createSuccessResponse('file_system', {
        operation: 'write',
        path: path.relative(this.contextDir, filePath),
        size: stats.size,
        modified: stats.mtime,
        message: `Successfully wrote file (${stats.size} bytes)`,
      });
    } catch (error: any) {
      return this.createErrorResponse(
        'file_system',
        `Failed to write file: ${error.message}`,
      );
    }
  }

  private async searchFiles(pattern: string, searchPath: string): Promise<any> {
    try {
      // Simple file search implementation
      const results: Array<{ path: string; matches: number }> = [];

      async function searchDir(dirPath: string): Promise<void> {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);

          if (entry.isDirectory()) {
            // Skip node_modules and other common directories
            if (
              !['node_modules', '.git', 'dist', 'build'].includes(entry.name)
            ) {
              await searchDir(fullPath);
            }
          } else if (entry.isFile()) {
            try {
              const content = await fs.readFile(fullPath, 'utf-8');
              if (content.includes(pattern)) {
                results.push({
                  path: path.relative(searchPath, fullPath),
                  matches: (content.match(new RegExp(pattern, 'g')) || [])
                    .length,
                });
              }
            } catch {
              // Skip files that can't be read
            }
          }
        }
      }

      await searchDir(searchPath);

      return this.createSuccessResponse('file_system', {
        operation: 'search',
        pattern,
        results,
        count: results.length,
        message: `Found ${results.length} files containing "${pattern}"`,
      });
    } catch (error: any) {
      return this.createErrorResponse(
        'file_system',
        `Failed to search files: ${error.message}`,
      );
    }
  }

  private async listDirectory(dirPath: string): Promise<any> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const files = [];
      const directories = [];

      for (const entry of entries) {
        const info = {
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
          path: path.relative(this.contextDir, path.join(dirPath, entry.name)),
        };

        if (entry.isDirectory()) {
          directories.push(info);
        } else {
          files.push(info);
        }
      }

      return this.createSuccessResponse('file_system', {
        operation: 'list',
        path: path.relative(this.contextDir, dirPath),
        directories,
        files,
        total: entries.length,
        message: `Listed ${entries.length} items (${directories.length} dirs, ${files.length} files)`,
      });
    } catch (error: any) {
      return this.createErrorResponse(
        'file_system',
        `Failed to list directory: ${error.message}`,
      );
    }
  }
}
