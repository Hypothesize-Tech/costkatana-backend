/**
 * Migration script to update Optimization collection schema
 * - Renames originalPrompt → userQuery
 * - Renames optimizedPrompt → generatedAnswer
 * - Removes applied/pending status fields
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Optimization } from '../models/Optimization';
import { loggingService } from '../services/logging.service';

dotenv.config();

async function migrateOptimizationSchema() {
    try {
        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-cost-optimizer';
        await mongoose.connect(mongoUri);
        
        loggingService.info('Connected to MongoDB for migration');

        // Get the collection
        const collection = mongoose.connection.collection('optimizations');

        // Step 1: Rename fields for all documents
        loggingService.info('Starting field renaming...');
        
        const renameResult = await collection.updateMany(
            {}, 
            {
                $rename: {
                    'originalPrompt': 'userQuery',
                    'optimizedPrompt': 'generatedAnswer'
                }
            }
        );
        
        loggingService.info(`Renamed fields in ${renameResult.modifiedCount} documents`);

        // Step 2: Remove applied/pending related fields
        loggingService.info('Removing applied/pending status fields...');
        
        const unsetResult = await collection.updateMany(
            {},
            {
                $unset: {
                    'applied': '',
                    'appliedAt': '',
                    'appliedCount': ''
                }
            }
        );
        
        loggingService.info(`Removed status fields from ${unsetResult.modifiedCount} documents`);

        // Step 3: Update any documents that might have both old and new fields
        // (in case of partial migrations)
        const cleanupResult = await collection.updateMany(
            {
                $or: [
                    { originalPrompt: { $exists: true } },
                    { optimizedPrompt: { $exists: true } }
                ]
            },
            {
                $unset: {
                    'originalPrompt': '',
                    'optimizedPrompt': ''
                }
            }
        );
        
        loggingService.info(`Cleaned up ${cleanupResult.modifiedCount} documents with old field names`);

        // Step 4: Verify migration
        const sampleDoc = await collection.findOne({});
        loggingService.info('Sample document after migration:', {
            hasUserQuery: !!sampleDoc?.userQuery,
            hasGeneratedAnswer: !!sampleDoc?.generatedAnswer,
            hasOriginalPrompt: !!sampleDoc?.originalPrompt,
            hasOptimizedPrompt: !!sampleDoc?.optimizedPrompt,
            hasApplied: !!sampleDoc?.applied,
            hasAppliedAt: !!sampleDoc?.appliedAt
        });

        loggingService.info('Migration completed successfully!');
        
    } catch (error) {
        loggingService.error('Migration failed:', { 
            error: error instanceof Error ? error.message : String(error) 
        });
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        loggingService.info('Disconnected from MongoDB');
        process.exit(0);
    }
}

// Run the migration
migrateOptimizationSchema();
