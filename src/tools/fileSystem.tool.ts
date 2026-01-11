import { Tool } from "@langchain/core/tools";
import { contextFileManager } from "../services/contextFileManager.service";
import { loggingService } from "../services/logging.service";

/**
 * File System Tool
 * 
 * Allows the agent to use the file system as "external memory" or "context".
 * It can read, write, and search files in the context directory.
 * This implements the "File System as Context" pattern from Manus AI.
 */
export class FileSystemTool extends Tool {
    name = "file_system";
    description = `Access the file system to read, write, and search files. 
    Use this as your external memory for large data, logs, or keeping track of complex tasks.
    
    Operations:
    - write: Save content to a file. Input: {"operation": "write", "path": "filename.txt", "content": "..."}
    - read: Read a file's content. Input: {"operation": "read", "path": "filename.txt"}
    - search: Search for a pattern in a file. Input: {"operation": "search", "path": "filename.txt", "pattern": "error"}
    - list: List files in your context directory. Input: {"operation": "list", "path": "optional_subdir"}
    - tail: specific lines from end. Input: {"operation": "tail", "path": "filename.txt", "lines": 50}
    
    Paths are relative to your secure context directory.`;

    async _call(input: string): Promise<string> {
        try {
            let params: any;
            try {
                // Handle both JSON string and direct object (if called internally)
                params = typeof input === 'string' ? JSON.parse(input) : input;
            } catch (e) {
                // If simple string, assume it's a list command or help
                if (input.trim() === 'list') {
                    params = { operation: 'list' };
                } else {
                    return "Error: Input must be a valid JSON object with an 'operation' field.";
                }
            }

            const operation = params.operation;
            const filePath = params.path;

            loggingService.info('FileSystemTool called', { operation, filePath });

            switch (operation) {
                case 'write':
                    if (!filePath || !params.content) {
                        return "Error: 'path' and 'content' are required for write operation.";
                    }
                    await contextFileManager.writeFile(filePath, params.content);
                    return `Successfully wrote to ${filePath}`;

                case 'read':
                    if (!filePath) return "Error: 'path' is required for read operation.";
                    return await contextFileManager.readContextFile(filePath);

                case 'search':
                    if (!filePath || !params.pattern) return "Error: 'path' and 'pattern' required.";
                    const results = await contextFileManager.searchInContextFile(filePath, params.pattern);
                    return JSON.stringify(results, null, 2);

                case 'tail':
                    if (!filePath) return "Error: 'path' is required.";
                    const lines = params.lines || 50;
                    return await contextFileManager.tailContextFile(filePath, lines);
                    
                case 'list':
                    const subDir = params.path || '';
                    const files = await contextFileManager.listFiles(subDir);
                    return `Files in '${subDir || 'root'}':\n${files.join('\n')}`;

                default:
                    return `Unknown operation: ${operation}. Supported: write, read, search, list, tail.`;
            }

        } catch (error) {
            loggingService.error('FileSystemTool error', { error: error instanceof Error ? error.message : String(error) });
            return `Error executing file system operation: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
}