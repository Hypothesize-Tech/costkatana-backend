/**
 * Background Maintenance Jobs for FAISS Vector Indices
 * Handles optimization, validation, backup, and cleanup tasks
 */

import * as cron from 'node-cron';
import * as fs from 'fs';
import * as path from 'path';
import * as tar from 'tar';
import { loggingService } from '../services/logging.service';
import { recoveryService } from '../services/vectorization/recovery.service';
import { faissVectorService } from '../services/vectorization/faiss.service';
import { S3Service } from '../services/s3.service';
import { DocumentModel } from '../models/Document';

export class VectorMaintenanceJobs {
    private jobs: Map<string, cron.ScheduledTask> = new Map();
    private isRunning = false;

    /**
     * Start all maintenance jobs
     */
    start(): void {
        if (this.isRunning) {
            loggingService.warn('Vector maintenance jobs already running', {
                component: 'VectorMaintenanceJobs'
            });
            return;
        }

        this.isRunning = true;

        // Nightly optimization (2 AM)
        this.scheduleOptimization();

        // Weekly validation (Sunday 3 AM)
        this.scheduleValidation();

        // Monthly S3 backup (1st of month, 4 AM)
        this.scheduleBackup();

        // Daily cleanup of unused indices (1 AM)
        this.scheduleCleanup();

        loggingService.info('Vector maintenance jobs started', {
            component: 'VectorMaintenanceJobs',
            jobs: Array.from(this.jobs.keys())
        });
    }

    /**
     * Stop all maintenance jobs
     */
    stop(): void {
        for (const [name, job] of this.jobs) {
            job.stop();
            loggingService.info(`Stopped maintenance job: ${name}`, {
                component: 'VectorMaintenanceJobs'
            });
        }
        this.jobs.clear();
        this.isRunning = false;
    }

    /**
     * Schedule nightly index optimization
     */
    private scheduleOptimization(): void {
        const job = cron.schedule('0 2 * * *', async () => {
            loggingService.info('Starting nightly FAISS index optimization', {
                component: 'VectorMaintenanceJobs',
                job: 'optimization'
            });

            try {
                await this.optimizeIndices();
                loggingService.info('FAISS index optimization completed', {
                    component: 'VectorMaintenanceJobs',
                    job: 'optimization'
                });
            } catch (error) {
                loggingService.error('FAISS index optimization failed', {
                    component: 'VectorMaintenanceJobs',
                    job: 'optimization',
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        });

        this.jobs.set('optimization', job);
        job.start();
    }

    /**
     * Schedule weekly validation
     */
    private scheduleValidation(): void {
        const job = cron.schedule('0 3 * * 0', async () => {
            loggingService.info('Starting weekly FAISS validation', {
                component: 'VectorMaintenanceJobs',
                job: 'validation'
            });

            try {
                const report = await recoveryService.validateAllIndices();
                
                // Log validation results
                loggingService.info('Weekly validation completed', {
                    component: 'VectorMaintenanceJobs',
                    job: 'validation',
                    totalIndices: report.totalIndices,
                    healthyIndices: report.healthyIndices,
                    corruptedIndices: report.corruptedIndices.length,
                    recommendations: report.recommendations
                });

                // Trigger rebuild if needed
                if (report.corruptedIndices.length > 0) {
                    loggingService.warn('Corrupted indices detected, triggering rebuild', {
                        component: 'VectorMaintenanceJobs',
                        job: 'validation',
                        corruptedIndices: report.corruptedIndices
                    });
                    
                    await recoveryService.rebuildInBackground();
                }
            } catch (error) {
                loggingService.error('Weekly validation failed', {
                    component: 'VectorMaintenanceJobs',
                    job: 'validation',
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        });

        this.jobs.set('validation', job);
        job.start();
    }

    /**
     * Schedule monthly S3 backup
     */
    private scheduleBackup(): void {
        const job = cron.schedule('0 4 1 * *', async () => {
            loggingService.info('Starting monthly FAISS backup to S3', {
                component: 'VectorMaintenanceJobs',
                job: 'backup'
            });

            try {
                await this.backupToS3();
                loggingService.info('Monthly FAISS backup completed', {
                    component: 'VectorMaintenanceJobs',
                    job: 'backup'
                });
            } catch (error) {
                loggingService.error('Monthly FAISS backup failed', {
                    component: 'VectorMaintenanceJobs',
                    job: 'backup',
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        });

        this.jobs.set('backup', job);
        job.start();
    }

    /**
     * Schedule daily cleanup of unused indices
     */
    private scheduleCleanup(): void {
        const job = cron.schedule('0 1 * * *', async () => {
            loggingService.info('Starting daily cleanup of unused indices', {
                component: 'VectorMaintenanceJobs',
                job: 'cleanup'
            });

            try {
                await this.cleanupUnusedIndices();
                loggingService.info('Daily cleanup completed', {
                    component: 'VectorMaintenanceJobs',
                    job: 'cleanup'
                });
            } catch (error) {
                loggingService.error('Daily cleanup failed', {
                    component: 'VectorMaintenanceJobs',
                    job: 'cleanup',
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        });

        this.jobs.set('cleanup', job);
        job.start();
    }

    /**
     * Optimize FAISS indices (compaction)
     */
    private async optimizeIndices(): Promise<void> {
        const indexPath = './data/faiss';
        
        // Optimize global index
        try {
            const globalPath = path.join(indexPath, 'global');
            await faissVectorService.getGlobalIndex();
            
            // Re-save to compact
            await faissVectorService.saveGlobalIndex();
            
            const beforeSize = this.getDirectorySize(globalPath);
            loggingService.info('Optimized global index', {
                component: 'VectorMaintenanceJobs',
                sizeBytes: beforeSize
            });
        } catch (error) {
            loggingService.error('Failed to optimize global index', {
                component: 'VectorMaintenanceJobs',
                error: error instanceof Error ? error.message : String(error)
            });
        }

        // Optimize user indices
        const usersPath = path.join(indexPath, 'users');
        if (fs.existsSync(usersPath)) {
            const userDirs = fs.readdirSync(usersPath);
            
            for (const userId of userDirs) {
                try {
                    const userIndex = await faissVectorService.getUserIndex(userId);
                    await faissVectorService.saveUserIndex(userId, userIndex);
                    
                    loggingService.info('Optimized user index', {
                        component: 'VectorMaintenanceJobs',
                        userId
                    });
                } catch (error) {
                    loggingService.error('Failed to optimize user index', {
                        component: 'VectorMaintenanceJobs',
                        userId,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }
        }
    }

    /**
     * Backup FAISS indices to S3
     */
    private async backupToS3(): Promise<void> {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = `faiss-backup-${timestamp}.tar.gz`;
        const tempPath = path.join('/tmp', backupName);

        try {
            // Create tar archive
            await tar.create(
                {
                    gzip: true,
                    file: tempPath,
                    cwd: './data'
                },
                ['faiss']
            );

            // Upload to S3
            const fileBuffer = fs.readFileSync(tempPath);
            const result = await S3Service.uploadDocument(
                'system',
                backupName,
                fileBuffer,
                'application/gzip',
                {
                    type: 'faiss-backup',
                    timestamp,
                    indexCount: String(this.countIndices())
                }
            );

            loggingService.info('FAISS backup uploaded to S3', {
                component: 'VectorMaintenanceJobs',
                backupName,
                s3Key: result.s3Key,
                sizeBytes: fileBuffer.length
            });

            // Clean up temp file
            fs.unlinkSync(tempPath);
        } catch (error) {
            loggingService.error('Failed to backup FAISS to S3', {
                component: 'VectorMaintenanceJobs',
                error: error instanceof Error ? error.message : String(error)
            });
            
            // Clean up temp file if exists
            if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
            }
        }
    }

    /**
     * Clean up unused user indices
     */
    private async cleanupUnusedIndices(): Promise<void> {
        const INACTIVE_DAYS = 30;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - INACTIVE_DAYS);

        const usersPath = path.join('./data/faiss/users');
        if (!fs.existsSync(usersPath)) {
            return;
        }

        const userDirs = fs.readdirSync(usersPath);
        let cleanedCount = 0;

        for (const userId of userDirs) {
            try {
                // Check last document access for this user
                const lastAccess = await DocumentModel.findOne({
                    'metadata.userId': userId,
                    status: 'active'
                })
                    .sort({ lastAccessedAt: -1 })
                    .select('lastAccessedAt')
                    .lean();

                if (!lastAccess || !lastAccess.lastAccessedAt || 
                    lastAccess.lastAccessedAt < cutoffDate) {
                    
                    // Delete unused index
                    await faissVectorService.deleteUserIndex(userId);
                    cleanedCount++;
                    
                    loggingService.info('Cleaned up unused user index', {
                        component: 'VectorMaintenanceJobs',
                        userId,
                        lastAccess: lastAccess?.lastAccessedAt
                    });
                }
            } catch (error) {
                loggingService.error('Failed to check/clean user index', {
                    component: 'VectorMaintenanceJobs',
                    userId,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }

        loggingService.info('Cleanup completed', {
            component: 'VectorMaintenanceJobs',
            totalUsers: userDirs.length,
            cleanedCount
        });
    }

    /**
     * Get directory size in bytes
     */
    private getDirectorySize(dirPath: string): number {
        let size = 0;
        
        if (!fs.existsSync(dirPath)) {
            return size;
        }

        const files = fs.readdirSync(dirPath);
        for (const file of files) {
            const filePath = path.join(dirPath, file);
            const stats = fs.statSync(filePath);
            
            if (stats.isDirectory()) {
                size += this.getDirectorySize(filePath);
            } else {
                size += stats.size;
            }
        }
        
        return size;
    }

    /**
     * Count total number of indices
     */
    private countIndices(): number {
        let count = 1; // Global index
        
        const usersPath = path.join('./data/faiss/users');
        if (fs.existsSync(usersPath)) {
            count += fs.readdirSync(usersPath).length;
        }
        
        return count;
    }

    /**
     * Run a specific job manually
     */
    async runJob(jobName: 'optimization' | 'validation' | 'backup' | 'cleanup'): Promise<void> {
        loggingService.info(`Manually running job: ${jobName}`, {
            component: 'VectorMaintenanceJobs'
        });

        switch (jobName) {
            case 'optimization':
                await this.optimizeIndices();
                break;
            case 'validation':
                const report = await recoveryService.validateAllIndices();
                if (report.corruptedIndices.length > 0) {
                    await recoveryService.rebuildInBackground();
                }
                break;
            case 'backup':
                await this.backupToS3();
                break;
            case 'cleanup':
                await this.cleanupUnusedIndices();
                break;
            default:
                throw new Error(`Unknown job: ${jobName}`);
        }
    }
}

// Export singleton instance
export const vectorMaintenanceJobs = new VectorMaintenanceJobs();