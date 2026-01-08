/**
 * Context File Manager Service
 * Manages all file-based context operations including large responses,
 * conversation history, and file lifecycle management
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { loggingService } from './logging.service';
import {
    FileReference,
    ConversationHistoryFile,
} from '../types/contextFile.types';

export class ContextFileManager {
    private static instance: ContextFileManager;
    private contextDirectory: string;
    private responsesDirectory: string;
    private conversationsDirectory: string;
    private largeResponseThreshold: number;
    private fileTTL: number;
    private cleanupInterval?: NodeJS.Timeout;
    private enableFileContext: boolean;

    // ECS container-friendly configuration with static values
    private static readonly CONTEXT_DIR = '/tmp/costkatana/context'; // Container temp storage
    private static readonly LARGE_RESPONSE_THRESHOLD = 10240; // 10KB
    private static readonly FILE_TTL = 86400000; // 24 hours in milliseconds
    private static readonly ENABLE_FILE_CONTEXT = true; // Always enabled

    private constructor() {
        this.contextDirectory = ContextFileManager.CONTEXT_DIR;
        this.responsesDirectory = path.join(this.contextDirectory, 'responses');
        this.conversationsDirectory = path.join(this.contextDirectory, 'conversations');
        this.largeResponseThreshold = ContextFileManager.LARGE_RESPONSE_THRESHOLD;
        this.fileTTL = ContextFileManager.FILE_TTL;
        this.enableFileContext = ContextFileManager.ENABLE_FILE_CONTEXT;
        
        loggingService.info('Context File Manager initialized', {
            contextDirectory: this.contextDirectory,
            largeResponseThreshold: this.largeResponseThreshold,
            fileTTL: this.fileTTL,
            enableFileContext: this.enableFileContext,
            environment: 'ECS Container'
        });
    }

    static getInstance(): ContextFileManager {
        if (!ContextFileManager.instance) {
            ContextFileManager.instance = new ContextFileManager();
        }
        return ContextFileManager.instance;
    }

    /**
     * Initialize the context file manager
     */
    async initialize(): Promise<void> {
        try {
            await fs.mkdir(this.contextDirectory, { recursive: true });
            await fs.mkdir(this.responsesDirectory, { recursive: true });
            await fs.mkdir(this.conversationsDirectory, { recursive: true });
            
            // Start cleanup interval
            this.startCleanupInterval();
            
            loggingService.info('Context file directories created', {
                contextDirectory: this.contextDirectory,
                responsesDirectory: this.responsesDirectory,
                conversationsDirectory: this.conversationsDirectory
            });
        } catch (error) {
            loggingService.error('Failed to initialize context file manager', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Write a large response to file
     */
    async writeResponse(
        response: any,
        metadata: {
            userId: string;
            requestId: string;
            toolName?: string;
        }
    ): Promise<FileReference> {
        if (!this.enableFileContext) {
            throw new Error('File context is disabled');
        }

        try {
            const userDir = path.join(this.responsesDirectory, metadata.userId);
            await fs.mkdir(userDir, { recursive: true });
            
            const fileName = metadata.toolName 
                ? `${metadata.requestId}_${metadata.toolName}.json`
                : `${metadata.requestId}_response.json`;
            
            const filePath = path.join(userDir, fileName);
            const responseData = JSON.stringify(response, null, 2);
            
            await fs.writeFile(filePath, responseData, 'utf-8');
            
            const stats = await fs.stat(filePath);
            const summary = this.generateSummary(response);
            
            const fileRef: FileReference = {
                type: 'file_reference',
                path: filePath,
                relativePath: path.relative(this.contextDirectory, filePath),
                size: stats.size,
                summary,
                instructions: `Use 'tail -n 50 ${filePath}' to preview, 'grep "pattern" ${filePath}' to search, or read the full file to access all data.`,
                metadata: {
                    toolName: metadata.toolName,
                    userId: metadata.userId,
                    requestId: metadata.requestId,
                    createdAt: new Date()
                }
            };
            
            loggingService.info('Large response written to file', {
                filePath,
                size: stats.size,
                toolName: metadata.toolName
            });
            
            return fileRef;
        } catch (error) {
            loggingService.error('Failed to write response file', {
                error: error instanceof Error ? error.message : String(error),
                metadata
            });
            throw error;
        }
    }

    /**
     * Check if response should be written to file
     */
    shouldWriteToFile(response: any): boolean {
        if (!this.enableFileContext) {
            return false;
        }
        
        const size = JSON.stringify(response).length;
        return size > this.largeResponseThreshold;
    }

    /**
     * Export conversation history to file
     */
    async exportConversationHistory(
        conversationId: string,
        userId: string,
        messages: Array<{
            role: string;
            content: string;
            timestamp: Date;
            metadata?: Record<string, unknown>;
        }>,
        format: 'markdown' | 'json' = 'markdown'
    ): Promise<ConversationHistoryFile> {
        if (!this.enableFileContext) {
            throw new Error('File context is disabled');
        }

        try {
            const userDir = path.join(this.conversationsDirectory, userId);
            await fs.mkdir(userDir, { recursive: true });
            
            const fileName = `${conversationId}_history.${format === 'markdown' ? 'md' : 'json'}`;
            const filePath = path.join(userDir, fileName);
            
            let content: string;
            if (format === 'markdown') {
                content = this.formatConversationAsMarkdown(messages);
            } else {
                content = JSON.stringify({ conversationId, messages }, null, 2);
            }
            
            await fs.writeFile(filePath, content, 'utf-8');
            
            const historyFile: ConversationHistoryFile = {
                conversationId,
                userId,
                filePath,
                messageCount: messages.length,
                format,
                createdAt: new Date()
            };
            
            loggingService.info('Conversation history exported', {
                conversationId,
                filePath,
                messageCount: messages.length,
                format
            });
            
            return historyFile;
        } catch (error) {
            loggingService.error('Failed to export conversation history', {
                error: error instanceof Error ? error.message : String(error),
                conversationId
            });
            throw error;
        }
    }

    /**
     * Read file content
     */
    async readFile(filePath: string): Promise<string> {
        try {
            return await fs.readFile(filePath, 'utf-8');
        } catch (error) {
            loggingService.error('Failed to read file', {
                error: error instanceof Error ? error.message : String(error),
                filePath
            });
            throw error;
        }
    }

    /**
     * Search in file
     */
    async searchInFile(filePath: string, pattern: string): Promise<string[]> {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const lines = content.split('\n');
            const regex = new RegExp(pattern, 'i');
            
            return lines.filter(line => regex.test(line));
        } catch (error) {
            loggingService.error('Failed to search in file', {
                error: error instanceof Error ? error.message : String(error),
                filePath,
                pattern
            });
            throw error;
        }
    }

    /**
     * Get file tail (last N lines)
     */
    async getFileTail(filePath: string, lines: number = 50): Promise<string> {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const allLines = content.split('\n');
            const tailLines = allLines.slice(-lines);
            
            return tailLines.join('\n');
        } catch (error) {
            loggingService.error('Failed to get file tail', {
                error: error instanceof Error ? error.message : String(error),
                filePath,
                lines
            });
            throw error;
        }
    }

    /**
     * Get file head (first N lines)
     */
    async getFileHead(filePath: string, lines: number = 50): Promise<string> {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const allLines = content.split('\n');
            const headLines = allLines.slice(0, lines);
            
            return headLines.join('\n');
        } catch (error) {
            loggingService.error('Failed to get file head', {
                error: error instanceof Error ? error.message : String(error),
                filePath,
                lines
            });
            throw error;
        }
    }

    /**
     * Cleanup old files based on TTL
     */
    async cleanupOldFiles(): Promise<{
        filesDeleted: number;
        bytesFreed: number;
    }> {
        let filesDeleted = 0;
        let bytesFreed = 0;

        try {
            const now = Date.now();
            
            // Cleanup response files
            await this.cleanupDirectory(this.responsesDirectory, now, (deleted, freed) => {
                filesDeleted += deleted;
                bytesFreed += freed;
            });
            
            // Cleanup conversation files
            await this.cleanupDirectory(this.conversationsDirectory, now, (deleted, freed) => {
                filesDeleted += deleted;
                bytesFreed += freed;
            });
            
            loggingService.info('File cleanup completed', {
                filesDeleted,
                bytesFreed
            });
            
            return { filesDeleted, bytesFreed };
        } catch (error) {
            loggingService.error('File cleanup failed', {
                error: error instanceof Error ? error.message : String(error)
            });
            return { filesDeleted, bytesFreed };
        }
    }

    /**
     * Clean up a specific directory
     */
    private async cleanupDirectory(
        directory: string,
        now: number,
        callback: (deleted: number, freed: number) => void
    ): Promise<void> {
        try {
            const entries = await fs.readdir(directory, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(directory, entry.name);
                
                if (entry.isDirectory()) {
                    await this.cleanupDirectory(fullPath, now, callback);
                } else if (entry.isFile()) {
                    const stats = await fs.stat(fullPath);
                    const age = now - stats.mtimeMs;
                    
                    if (age > this.fileTTL) {
                        await fs.unlink(fullPath);
                        callback(1, stats.size);
                        
                        loggingService.info('Deleted old file', {
                            file: fullPath,
                            age,
                            size: stats.size
                        });
                    }
                }
            }
        } catch (error) {
            loggingService.warn('Failed to cleanup directory', {
                error: error instanceof Error ? error.message : String(error),
                directory
            });
        }
    }

    /**
     * Start cleanup interval
     */
    private startCleanupInterval(): void {
        // Run cleanup every hour
        this.cleanupInterval = setInterval(() => {
            void this.cleanupOldFiles();
        }, 60 * 60 * 1000);
        
        loggingService.info('File cleanup interval started');
    }

    /**
     * Stop cleanup interval
     */
    stopCleanupInterval(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = undefined;
            loggingService.info('File cleanup interval stopped');
        }
    }

    /**
     * Generate summary for response
     */
    private generateSummary(response: unknown): string {
        try {
            if (Array.isArray(response)) {
                return `Array with ${response.length} items. First item: ${JSON.stringify(response[0]).substring(0, 100)}...`;
            } else if (typeof response === 'object' && response !== null) {
                const keys = Object.keys(response);
                return `Object with ${keys.length} keys: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''}`;
            } else {
                return `${String(response).substring(0, 100)}...`;
            }
        } catch {
            return 'Large response data';
        }
    }

    /**
     * Format conversation as markdown
     */
    private formatConversationAsMarkdown(messages: Array<{
        role: string;
        content: string;
        timestamp: Date;
        metadata?: Record<string, unknown>;
    }>): string {
        let markdown = '# Conversation History\n\n';
        
        for (const message of messages) {
            const timestamp = new Date(message.timestamp).toLocaleString();
            markdown += `## ${message.role.toUpperCase()} - ${timestamp}\n\n`;
            markdown += `${message.content}\n\n`;
            
            if (message.metadata) {
                markdown += `*Metadata: ${JSON.stringify(message.metadata)}*\n\n`;
            }
            
            markdown += '---\n\n';
        }
        
        return markdown;
    }

    /**
     * Get statistics
     */
    async getStatistics(): Promise<{
        totalFiles: number;
        totalSize: number;
        responseFiles: number;
        conversationFiles: number;
    }> {
        try {
            const stats = {
                totalFiles: 0,
                totalSize: 0,
                responseFiles: 0,
                conversationFiles: 0
            };
            
            // Count response files
            await this.countFilesInDirectory(this.responsesDirectory, stats, 'response');
            
            // Count conversation files
            await this.countFilesInDirectory(this.conversationsDirectory, stats, 'conversation');
            
            return stats;
        } catch (error) {
            loggingService.error('Failed to get statistics', {
                error: error instanceof Error ? error.message : String(error)
            });
            return {
                totalFiles: 0,
                totalSize: 0,
                responseFiles: 0,
                conversationFiles: 0
            };
        }
    }

    /**
     * Count files in directory recursively
     */
    private async countFilesInDirectory(
        directory: string,
        stats: { totalFiles: number; totalSize: number; responseFiles: number; conversationFiles: number },
        type: 'response' | 'conversation'
    ): Promise<void> {
        try {
            const entries = await fs.readdir(directory, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(directory, entry.name);
                
                if (entry.isDirectory()) {
                    await this.countFilesInDirectory(fullPath, stats, type);
                } else if (entry.isFile()) {
                    const fileStat = await fs.stat(fullPath);
                    stats.totalFiles++;
                    stats.totalSize += fileStat.size;
                    
                    if (type === 'response') {
                        stats.responseFiles++;
                    } else {
                        stats.conversationFiles++;
                    }
                }
            }
        } catch (error) {
            // Directory might not exist yet
        }
    }

    /**
     * Get context directory path
     */
    getContextDirectory(): string {
        return this.contextDirectory;
    }

    /**
     * Get responses directory path
     */
    getResponsesDirectory(): string {
        return this.responsesDirectory;
    }

    /**
     * Get conversations directory path
     */
    getConversationsDirectory(): string {
        return this.conversationsDirectory;
    }

    /**
     * Check if file context is enabled
     */
    isEnabled(): boolean {
        return this.enableFileContext;
    }
}

// Export singleton instance
export const contextFileManager = ContextFileManager.getInstance();
