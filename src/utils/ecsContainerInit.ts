/**
 * ECS Container Initialization Script
 * Ensures /tmp directories exist with proper permissions
 * Run this on container startup
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { loggingService } from '../services/logging.service';

export class ECSContainerInit {
    // Container-specific directories
    private static readonly DIRECTORIES = [
        '/tmp/costkatana',
        '/tmp/costkatana/tools',
        '/tmp/costkatana/tools/mongodb',
        '/tmp/costkatana/tools/vercel',
        '/tmp/costkatana/tools/analytics',
        '/tmp/costkatana/tools/aws',
        '/tmp/costkatana/tools/github',
        '/tmp/costkatana/tools/google',
        '/tmp/costkatana/context',
        '/tmp/costkatana/context/responses',
        '/tmp/costkatana/context/conversations'
    ];

    /**
     * Initialize container directories for file-based context
     */
    static async initialize(): Promise<void> {
        try {
            loggingService.info('Initializing ECS container directories', {
                directories: this.DIRECTORIES.length
            });

            for (const dir of this.DIRECTORIES) {
                try {
                    await fs.mkdir(dir, { recursive: true, mode: 0o755 });
                    loggingService.info('Directory created', { path: dir });
                } catch (error) {
                    // Directory might already exist
                    if ((error as any).code !== 'EEXIST') {
                        loggingService.warn('Failed to create directory', {
                            path: dir,
                            error: error instanceof Error ? error.message : String(error)
                        });
                    }
                }
            }

            // Verify directories are accessible
            for (const dir of this.DIRECTORIES) {
                try {
                    await fs.access(dir, fs.constants.W_OK);
                } catch (error) {
                    loggingService.error('Directory not writable', {
                        path: dir,
                        error: error instanceof Error ? error.message : String(error)
                    });
                    throw new Error(`Container directory not writable: ${dir}`);
                }
            }

            loggingService.info('✅ ECS container directories initialized successfully', {
                totalDirectories: this.DIRECTORIES.length,
                baseDir: '/tmp/costkatana'
            });

        } catch (error) {
            loggingService.error('Failed to initialize ECS container directories', {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            throw error;
        }
    }

    /**
     * Get directory statistics
     */
    static async getStats(): Promise<{
        directories: Array<{ path: string; exists: boolean; writable: boolean }>;
        totalSpace: string;
    }> {
        const stats: Array<{ path: string; exists: boolean; writable: boolean }> = [];

        for (const dir of this.DIRECTORIES) {
            let exists = false;
            let writable = false;

            try {
                await fs.access(dir);
                exists = true;
                await fs.access(dir, fs.constants.W_OK);
                writable = true;
            } catch {
                // Directory doesn't exist or not writable
            }

            stats.push({ path: dir, exists, writable });
        }

        return {
            directories: stats,
            totalSpace: 'N/A' // In container, /tmp is typically ephemeral
        };
    }

    /**
     * Cleanup old files to prevent /tmp from filling up
     */
    static async cleanup(): Promise<{
        filesDeleted: number;
        bytesFreed: number;
    }> {
        let filesDeleted = 0;
        let bytesFreed = 0;

        try {
            const baseDir = '/tmp/costkatana';
            const now = Date.now();
            const maxAge = 24 * 60 * 60 * 1000; // 24 hours

            const cleanup = async (directory: string) => {
                try {
                    const entries = await fs.readdir(directory, { withFileTypes: true });

                    for (const entry of entries) {
                        const fullPath = path.join(directory, entry.name);

                        if (entry.isDirectory()) {
                            await cleanup(fullPath);
                        } else if (entry.isFile()) {
                            const stats = await fs.stat(fullPath);
                            const age = now - stats.mtimeMs;

                            if (age > maxAge) {
                                await fs.unlink(fullPath);
                                filesDeleted++;
                                bytesFreed += stats.size;
                            }
                        }
                    }
                } catch (error) {
                    loggingService.warn('Cleanup error for directory', {
                        directory,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            };

            await cleanup(baseDir);

            loggingService.info('Container cleanup completed', {
                filesDeleted,
                bytesFreed
            });

        } catch (error) {
            loggingService.error('Container cleanup failed', {
                error: error instanceof Error ? error.message : String(error)
            });
        }

        return { filesDeleted, bytesFreed };
    }

    /**
     * Health check for container directories
     */
    static async healthCheck(): Promise<{
        healthy: boolean;
        issues: string[];
    }> {
        const issues: string[] = [];

        // Check if directories exist and are writable
        for (const dir of this.DIRECTORIES) {
            try {
                await fs.access(dir, fs.constants.W_OK);
            } catch {
                issues.push(`Directory not accessible: ${dir}`);
            }
        }

        // Check /tmp space (basic check)
        try {
            const testFile = '/tmp/costkatana/.healthcheck';
            await fs.writeFile(testFile, 'test', 'utf-8');
            await fs.unlink(testFile);
        } catch {
            issues.push('Cannot write to /tmp/costkatana');
        }

        return {
            healthy: issues.length === 0,
            issues
        };
    }
}
