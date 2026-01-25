import { DocumentModel } from '../models/Document';
import { metadataEnrichmentService } from '../services/metadataEnrichment.service';
import { loggingService } from '../services/logging.service';
import { EnrichmentContext } from '../types/metadata.types';

/**
 * Migration Script: Enrich Existing Documents with Semantic Metadata
 * 
 * This script enriches all existing documents in the database with semantic metadata
 * including domain, topics, content type, quality score, and other enhanced fields.
 * 
 * Usage:
 *   npm run migrate:enrich-metadata
 *   OR
 *   node -r ts-node/register src/migrations/enrichExistingDocuments.ts
 */

interface MigrationStats {
    totalDocuments: number;
    processed: number;
    enriched: number;
    skipped: number;
    errors: number;
    startTime: Date;
    endTime?: Date;
    duration?: number;
}

/**
 * Main migration function
 */
export async function migrateExistingDocuments(
    batchSize: number = 100,
    dryRun: boolean = false
): Promise<MigrationStats> {
    const stats: MigrationStats = {
        totalDocuments: 0,
        processed: 0,
        enriched: 0,
        skipped: 0,
        errors: 0,
        startTime: new Date()
    };

    try {
        loggingService.info('Starting metadata enrichment migration', {
            component: 'MigrationScript',
            operation: 'migrateExistingDocuments',
            batchSize,
            dryRun
        });

        // Count total documents to process
        stats.totalDocuments = await DocumentModel.countDocuments({
            'metadata.domain': { $exists: false }
        });

        loggingService.info('Documents to process', {
            component: 'MigrationScript',
            totalDocuments: stats.totalDocuments
        });

        if (stats.totalDocuments === 0) {
            loggingService.info('No documents need enrichment');
            return stats;
        }

        // Process documents in batches using cursor for memory efficiency
        const cursor = DocumentModel.find({
            'metadata.domain': { $exists: false },
            status: 'active' // Only process active documents
        })
        .select('content metadata')
        .cursor();

        let batch: any[] = [];

        for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
            batch.push(doc);
            stats.processed++;

            // Process batch when it reaches batchSize
            if (batch.length >= batchSize) {
                await processBatch(batch, stats, dryRun);
                batch = [];

                // Log progress every batch
                loggingService.info('Migration progress', {
                    processed: stats.processed,
                    enriched: stats.enriched,
                    skipped: stats.skipped,
                    errors: stats.errors,
                    progress: `${Math.round((stats.processed / stats.totalDocuments) * 100)}%`
                });
            }
        }

        // Process remaining documents in final batch
        if (batch.length > 0) {
            await processBatch(batch, stats, dryRun);
        }

        stats.endTime = new Date();
        stats.duration = stats.endTime.getTime() - stats.startTime.getTime();

        loggingService.info('Migration completed', {
            component: 'MigrationScript',
            operation: 'migrateExistingDocuments',
            ...stats,
            durationMinutes: Math.round(stats.duration / 1000 / 60)
        });

        return stats;
    } catch (error) {
        loggingService.error('Migration failed', {
            component: 'MigrationScript',
            operation: 'migrateExistingDocuments',
            error: error instanceof Error ? error.message : String(error),
            stats
        });
        throw error;
    }
}

/**
 * Process a batch of documents
 */
async function processBatch(
    batch: any[],
    stats: MigrationStats,
    dryRun: boolean
): Promise<void> {
    const enrichmentPromises = batch.map(async (doc) => {
        try {
            // Skip if content is too short
            if (!doc.content || doc.content.length < 50) {
                stats.skipped++;
                return;
            }

            // Build enrichment context
            const context: EnrichmentContext = {
                userId: doc.metadata?.userId,
                projectId: doc.metadata?.projectId,
                source: doc.metadata?.source,
                existingTags: doc.metadata?.tags,
                fileName: doc.metadata?.fileName,
                language: doc.metadata?.language
            };

            // Enrich metadata
            const enrichmentResult = await metadataEnrichmentService.enrichMetadata(
                doc.content,
                context
            );

            if (!dryRun) {
                // Update document with enriched metadata
                await DocumentModel.updateOne(
                    { _id: doc._id },
                    {
                        $set: {
                            'metadata.domain': enrichmentResult.enrichedMetadata.domain,
                            'metadata.topic': enrichmentResult.enrichedMetadata.topic,
                            'metadata.topics': enrichmentResult.enrichedMetadata.topics,
                            'metadata.contentType': enrichmentResult.enrichedMetadata.contentType,
                            'metadata.importance': enrichmentResult.enrichedMetadata.importance,
                            'metadata.qualityScore': enrichmentResult.enrichedMetadata.qualityScore,
                            'metadata.technicalLevel': enrichmentResult.enrichedMetadata.technicalLevel,
                            'metadata.semanticTags': enrichmentResult.enrichedMetadata.semanticTags,
                            'metadata.lastVerified': enrichmentResult.enrichedMetadata.lastVerified,
                            'metadata.containsCode': enrichmentResult.enrichedMetadata.containsCode,
                            'metadata.containsEquations': enrichmentResult.enrichedMetadata.containsEquations,
                            'metadata.containsLinks': enrichmentResult.enrichedMetadata.containsLinks,
                            'metadata.containsImages': enrichmentResult.enrichedMetadata.containsImages
                        }
                    }
                );
            }

            stats.enriched++;

            loggingService.debug('Document enriched', {
                documentId: doc._id,
                domain: enrichmentResult.enrichedMetadata.domain,
                topics: enrichmentResult.enrichedMetadata.topics?.length || 0,
                qualityScore: enrichmentResult.enrichedMetadata.qualityScore,
                dryRun
            });
        } catch (error) {
            stats.errors++;
            loggingService.error('Failed to enrich document', {
                component: 'MigrationScript',
                documentId: doc._id,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    });

    // Process batch in parallel
    await Promise.all(enrichmentPromises);
}

/**
 * Rollback migration (remove enriched metadata)
 */
export async function rollbackMigration(): Promise<void> {
    try {
        loggingService.info('Starting migration rollback', {
            component: 'MigrationScript',
            operation: 'rollbackMigration'
        });

        const result = await DocumentModel.updateMany(
            { 'metadata.domain': { $exists: true } },
            {
                $unset: {
                    'metadata.domain': '',
                    'metadata.topic': '',
                    'metadata.topics': '',
                    'metadata.contentType': '',
                    'metadata.importance': '',
                    'metadata.qualityScore': '',
                    'metadata.technicalLevel': '',
                    'metadata.semanticTags': '',
                    'metadata.lastVerified': '',
                    'metadata.containsCode': '',
                    'metadata.containsEquations': '',
                    'metadata.containsLinks': '',
                    'metadata.containsImages': ''
                }
            }
        );

        loggingService.info('Migration rollback completed', {
            component: 'MigrationScript',
            operation: 'rollbackMigration',
            documentsUpdated: result.modifiedCount
        });
    } catch (error) {
        loggingService.error('Migration rollback failed', {
            component: 'MigrationScript',
            operation: 'rollbackMigration',
            error: error instanceof Error ? error.message : String(error)
        });
        throw error;
    }
}

// CLI execution
if (require.main === module) {
    const mongoose = require('mongoose');
    
    (async () => {
        try {
            // Connect to MongoDB
            const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/cost-katana';
            await mongoose.connect(mongoUri);
            
            loggingService.info('Connected to MongoDB', { uri: mongoUri.replace(/\/\/.*@/, '//<credentials>@') });

            // Parse CLI arguments
            const args = process.argv.slice(2);
            const dryRun = args.includes('--dry-run');
            const rollback = args.includes('--rollback');
            const batchSizeArg = args.find(arg => arg.startsWith('--batch-size='));
            const batchSize = batchSizeArg ? parseInt(batchSizeArg.split('=')[1]) : 100;

            if (rollback) {
                await rollbackMigration();
            } else {
                const stats = await migrateExistingDocuments(batchSize, dryRun);
                
                console.log('\n=== Migration Complete ===');
                console.log(`Total documents: ${stats.totalDocuments}`);
                console.log(`Processed: ${stats.processed}`);
                console.log(`Enriched: ${stats.enriched}`);
                console.log(`Skipped: ${stats.skipped}`);
                console.log(`Errors: ${stats.errors}`);
                console.log(`Duration: ${stats.duration ? Math.round(stats.duration / 1000) : 0} seconds`);
                console.log(`Dry run: ${dryRun}`);
            }

            await mongoose.disconnect();
            process.exit(0);
        } catch (error) {
            console.error('Migration failed:', error);
            process.exit(1);
        }
    })();
}

export default {
    migrateExistingDocuments,
    rollbackMigration
};
