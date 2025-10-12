import { Telemetry } from '../models/Telemetry';
import { loggingService } from './logging.service';
import cron from 'node-cron';
import mongoose from 'mongoose';

export interface CleanupStats {
    deletedCount: number;
    modifiedCount: number;
    spaceSavedMB: number;
    duration: number;
}

export interface CleanupConfig {
    errorRetentionDays: number;
    successRetentionDays: number;
    vectorRetentionDays: number;
    sampleRate: number;
    enableVectorization: boolean;
}

export class TelemetryCleanupService {
    private static isCleanupRunning = false;
    private static lastCleanupTime: Date | null = null;
    private static cleanupStats: CleanupStats = {
        deletedCount: 0,
        modifiedCount: 0,
        spaceSavedMB: 0,
        duration: 0
    };

    // Default configuration (can be overridden via environment variables)
    private static config: CleanupConfig = {
        errorRetentionDays: parseInt(process.env.TELEMETRY_ERROR_RETENTION_DAYS || '30'),
        successRetentionDays: parseInt(process.env.TELEMETRY_SUCCESS_RETENTION_DAYS || '7'),
        vectorRetentionDays: parseInt(process.env.TELEMETRY_VECTOR_RETENTION_DAYS || '3'),
        sampleRate: parseFloat(process.env.TELEMETRY_SAMPLE_RATE || '0.1'),
        enableVectorization: process.env.ENABLE_TELEMETRY_VECTORIZATION === 'true'
    };

    /**
     * Get current cleanup configuration
     */
    static getConfig(): CleanupConfig {
        return { ...this.config };
    }

    /**
     * Update cleanup configuration
     */
    static updateConfig(newConfig: Partial<CleanupConfig>): void {
        this.config = { ...this.config, ...newConfig };
        loggingService.info('📝 Telemetry cleanup configuration updated', { config: this.config });
    }

    /**
     * Get last cleanup statistics
     */
    static getStats(): { stats: CleanupStats; lastRun: Date | null; isRunning: boolean } {
        return {
            stats: { ...this.cleanupStats },
            lastRun: this.lastCleanupTime,
            isRunning: this.isCleanupRunning
        };
    }

    /**
     * Comprehensive telemetry cleanup - Main method
     */
    static async runComprehensiveCleanup(): Promise<CleanupStats> {
        if (this.isCleanupRunning) {
            loggingService.warn('⚠️ Telemetry cleanup already in progress, skipping...');
            return this.cleanupStats;
        }

        this.isCleanupRunning = true;
        const startTime = Date.now();
        let totalDeleted = 0;
        let totalModified = 0;

        try {
            loggingService.info('🧹 Starting comprehensive telemetry cleanup...', { config: this.config });

            // Get initial collection size
            const initialCount = await Telemetry.estimatedDocumentCount();
            const initialSizeMB = initialCount * 0.02; // Estimate ~20KB per document
            loggingService.info('📊 Initial telemetry collection size', { sizeMB: initialSizeMB.toFixed(2) });

            // Step 1: Delete old non-error telemetry (aggressive)
            loggingService.info('🔹 Step 1: Cleaning old successful requests...');
            const successDeleted = await this.cleanupNonErrorTelemetry(this.config.successRetentionDays);
            totalDeleted += successDeleted;

            // Step 2: Delete very old error telemetry
            loggingService.info('🔹 Step 2: Cleaning old error records...');
            const errorDeleted = await this.cleanupOldErrors(this.config.errorRetentionDays);
            totalDeleted += errorDeleted;

            // Step 3: Remove vector embeddings from older records
            loggingService.info('🔹 Step 3: Removing old vector embeddings...');
            const vectorsRemoved = await this.removeOldVectorEmbeddings(this.config.vectorRetentionDays);
            totalModified += vectorsRemoved;

            // Step 4: Sample down successful requests (keep only sample rate %)
            loggingService.info('🔹 Step 4: Sampling successful requests...');
            const sampled = await this.sampleSuccessfulRequests(this.config.sampleRate);
            totalDeleted += sampled;

            // Step 5: Clean up orphaned data and duplicates
            loggingService.info('🔹 Step 5: Cleaning orphaned and duplicate data...');
            const orphansDeleted = await this.cleanupOrphanedData();
            totalDeleted += orphansDeleted;

            // Step 6: Remove large attributes from old records
            loggingService.info('🔹 Step 6: Removing large attributes...');
            const attributesRemoved = await this.removeLargeAttributes();
            totalModified += attributesRemoved;

            // Get final collection size
            const finalCount = await Telemetry.estimatedDocumentCount();
            const finalSizeMB = finalCount * 0.02; // Estimate ~20KB per document
            const spaceSaved = initialSizeMB - finalSizeMB;

            const duration = Date.now() - startTime;
            
            this.cleanupStats = {
                deletedCount: totalDeleted,
                modifiedCount: totalModified,
                spaceSavedMB: Math.max(0, spaceSaved),
                duration
            };

            this.lastCleanupTime = new Date();

            loggingService.info('✅ Comprehensive telemetry cleanup completed', {
                deletedRecords: totalDeleted,
                modifiedRecords: totalModified,
                spaceSavedMB: spaceSaved.toFixed(2),
                finalSizeMB: finalSizeMB.toFixed(2),
                durationMs: duration,
                timestamp: new Date()
            });

            return this.cleanupStats;

        } catch (error) {
            loggingService.error('❌ Comprehensive telemetry cleanup failed:', { 
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            throw error;
        } finally {
            this.isCleanupRunning = false;
        }
    }

    /**
     * Delete non-error telemetry older than specified days
     */
    private static async cleanupNonErrorTelemetry(daysToKeep: number): Promise<number> {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

            const result = await Telemetry.deleteMany({
                timestamp: { $lt: cutoffDate },
                status: { $in: ['success', 'unset'] }
            });

            loggingService.info(`  ✓ Deleted ${result.deletedCount} old non-error records (>${daysToKeep} days)`);
            return result.deletedCount || 0;
        } catch (error) {
            loggingService.error('  ✗ Non-error telemetry cleanup failed:', { error });
            return 0;
        }
    }

    /**
     * Delete error telemetry older than specified days
     */
    private static async cleanupOldErrors(daysToKeep: number): Promise<number> {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

            const result = await Telemetry.deleteMany({
                timestamp: { $lt: cutoffDate },
                status: 'error'
            });

            loggingService.info(`  ✓ Deleted ${result.deletedCount} old error records (>${daysToKeep} days)`);
            return result.deletedCount || 0;
        } catch (error) {
            loggingService.error('  ✗ Error telemetry cleanup failed:', { error });
            return 0;
        }
    }

    /**
     * Remove vector embeddings from old records to save space
     */
    private static async removeOldVectorEmbeddings(daysToKeep: number): Promise<number> {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

            const result = await Telemetry.updateMany(
                { 
                    timestamp: { $lt: cutoffDate },
                    semantic_embedding: { $exists: true }
                },
                { 
                    $unset: { 
                        semantic_embedding: 1,
                        semantic_content: 1,
                        cost_narrative: 1
                    }
                }
            );

            loggingService.info(`  ✓ Removed embeddings from ${result.modifiedCount} records (>${daysToKeep} days)`);
            return result.modifiedCount || 0;
        } catch (error) {
            loggingService.error('  ✗ Vector embedding removal failed:', { error });
            return 0;
        }
    }

    /**
     * Sample successful requests - keep only specified percentage
     */
    private static async sampleSuccessfulRequests(sampleRate: number): Promise<number> {
        try {
            if (sampleRate >= 1.0) {
                loggingService.info('  ↷ Sampling skipped (sample rate = 100%)');
                return 0;
            }

            const oneDayAgo = new Date();
            oneDayAgo.setDate(oneDayAgo.getDate() - 1);

            // Use random field to sample (deterministic based on _id)
            const deleteThreshold = Math.floor((1 - sampleRate) * 100);

            const result = await Telemetry.deleteMany({
                timestamp: { $lt: oneDayAgo },
                status: 'success',
                // Delete records where (_id mod 100) > threshold
                $expr: { 
                    $gt: [
                        { $mod: [{ $toLong: '$_id' }, 100] },
                        deleteThreshold
                    ]
                }
            });

            const deletedCount = result.deletedCount || 0;
            loggingService.info(`  ✓ Sampled ${deletedCount} successful requests (keeping ${sampleRate * 100}%)`);
            return deletedCount;
        } catch (error) {
            loggingService.error('  ✗ Sampling failed:', { error });
            return 0;
        }
    }

    /**
     * Clean up orphaned data and duplicates
     */
    private static async cleanupOrphanedData(): Promise<number> {
        try {
            // Remove records with missing required fields
            const result = await Telemetry.deleteMany({
                $or: [
                    { trace_id: { $in: [null, ''] } },
                    { span_id: { $in: [null, ''] } },
                    { timestamp: { $exists: false } },
                    { service_name: { $in: [null, ''] } }
                ]
            });

            loggingService.info(`  ✓ Deleted ${result.deletedCount} orphaned/invalid records`);
            return result.deletedCount || 0;
        } catch (error) {
            loggingService.error('  ✗ Orphaned data cleanup failed:', { error });
            return 0;
        }
    }

    /**
     * Remove large attributes from old records to reduce size
     */
    private static async removeLargeAttributes(): Promise<number> {
        try {
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

            const result = await Telemetry.updateMany(
                { timestamp: { $lt: sevenDaysAgo } },
                { 
                    $unset: {
                        error_stack: 1,
                        db_statement: 1,
                        'attributes.large_data': 1,
                        events: 1,
                        links: 1
                    }
                }
            );

            loggingService.info(`  ✓ Removed large attributes from ${result.modifiedCount} records`);
            return result.modifiedCount || 0;
        } catch (error) {
            loggingService.error('  ✗ Large attributes removal failed:', { error });
            return 0;
        }
    }

    /**
     * Emergency cleanup - when database is critically full
     */
    static async emergencyCleanup(): Promise<CleanupStats> {
        loggingService.warn('🚨 EMERGENCY TELEMETRY CLEANUP INITIATED');

        const startTime = Date.now();
        let totalDeleted = 0;

        try {
            // Delete all successful requests older than 24 hours
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const result1 = await Telemetry.deleteMany({
                timestamp: { $lt: oneDayAgo },
                status: 'success'
            });
            totalDeleted += result1.deletedCount || 0;

            // Remove all vector embeddings
            const result2 = await Telemetry.updateMany(
                { semantic_embedding: { $exists: true } },
                { $unset: { semantic_embedding: 1, semantic_content: 1, cost_narrative: 1 } }
            );

            // Remove all large attributes
            const result3 = await Telemetry.updateMany(
                {},
                { 
                    $unset: {
                        error_stack: 1,
                        db_statement: 1,
                        events: 1,
                        links: 1,
                        attributes: 1
                    }
                }
            );

            const stats: CleanupStats = {
                deletedCount: totalDeleted,
                modifiedCount: (result2.modifiedCount || 0) + (result3.modifiedCount || 0),
                spaceSavedMB: 0,
                duration: Date.now() - startTime
            };

            loggingService.warn('🚨 Emergency cleanup completed', stats);
            return stats;

        } catch (error) {
            loggingService.error('❌ Emergency cleanup failed:', { error });
            throw error;
        }
    }

    /**
     * Schedule automatic cleanup jobs
     */
    static scheduleCleanup(): void {
        loggingService.info('⏰ Scheduling telemetry cleanup jobs...');

        // Daily comprehensive cleanup at 2 AM
        cron.schedule('0 2 * * *', async () => {
            loggingService.info('⏰ Running scheduled daily telemetry cleanup...');
            try {
                await this.runComprehensiveCleanup();
            } catch (error) {
                loggingService.error('❌ Scheduled daily cleanup failed:', { error });
            }
        });

        // Hourly quick cleanup (remove old vectors)
        cron.schedule('0 * * * *', async () => {
            loggingService.info('⏰ Running hourly vector cleanup...');
            try {
                await this.removeOldVectorEmbeddings(this.config.vectorRetentionDays);
            } catch (error) {
                loggingService.error('❌ Hourly vector cleanup failed:', { error });
            }
        });

        // Weekly deep cleanup on Sundays at 3 AM
        cron.schedule('0 3 * * 0', async () => {
            loggingService.info('⏰ Running weekly deep cleanup...');
            try {
                // Temporarily reduce retention for deep clean
                const originalConfig = { ...this.config };
                this.config.successRetentionDays = 3;
                this.config.vectorRetentionDays = 1;
                
                await this.runComprehensiveCleanup();
                
                // Restore original config
                this.config = originalConfig;
            } catch (error) {
                loggingService.error('❌ Weekly deep cleanup failed:', { error });
            }
        });

        loggingService.info('✅ Telemetry cleanup jobs scheduled', {
            daily: '2 AM - Comprehensive cleanup',
            hourly: 'Every hour - Vector cleanup',
            weekly: 'Sunday 3 AM - Deep cleanup'
        });
    }

    /**
     * Manual cleanup trigger (for admin use)
     */
    static async manualCleanup(options?: {
        emergency?: boolean;
        daysToKeep?: number;
    }): Promise<CleanupStats> {
        loggingService.info('🔧 Manual telemetry cleanup triggered', { options });

        if (options?.emergency) {
            return await this.emergencyCleanup();
        }

        if (options?.daysToKeep) {
            const originalRetention = this.config.successRetentionDays;
            this.config.successRetentionDays = options.daysToKeep;
            this.config.errorRetentionDays = options.daysToKeep;
            
            const stats = await this.runComprehensiveCleanup();
            
            this.config.successRetentionDays = originalRetention;
            return stats;
        }

        return await this.runComprehensiveCleanup();
    }

    /**
     * Get telemetry collection statistics
     */
    static async getCollectionStats(): Promise<{
        totalDocuments: number;
        totalSizeMB: number;
        avgDocSizeKB: number;
        indexSizeMB: number;
        oldestRecord: Date | null;
        newestRecord: Date | null;
    }> {
        try {
            const totalDocs = await Telemetry.estimatedDocumentCount();
            const oldest = await Telemetry.findOne().sort({ timestamp: 1 }).select('timestamp').lean();
            const newest = await Telemetry.findOne().sort({ timestamp: -1 }).select('timestamp').lean();

            return {
                totalDocuments: totalDocs,
                totalSizeMB: totalDocs * 0.02, // Estimate ~20KB per document
                avgDocSizeKB: 20, // Estimated average
                indexSizeMB: totalDocs * 0.005, // Estimate ~5KB index per document
                oldestRecord: oldest?.timestamp || null,
                newestRecord: newest?.timestamp || null
            };
        } catch (error) {
            loggingService.error('Failed to get collection stats:', { error });
            throw error;
        }
    }
}

