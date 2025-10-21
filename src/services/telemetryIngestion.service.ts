import { Telemetry } from '../models/Telemetry';
import { BedrockEmbeddings } from '@langchain/aws';
import { DocumentModel } from '../models/Document';
import { loggingService } from './logging.service';
import crypto from 'crypto';

/**
 * Service for ingesting telemetry data into the RAG system
 * Extracts insights from cost narratives and semantic content
 */
export class TelemetryIngestionService {
    private embeddings: BedrockEmbeddings;

    constructor() {
        this.embeddings = new BedrockEmbeddings({
            region: process.env.AWS_REGION || 'us-east-1',
            model: process.env.RAG_EMBEDDING_MODEL || 'amazon.titan-embed-text-v2:0',
        });
    }

    /**
     * Ingest telemetry records with semantic content
     */
    async ingestTelemetryRecords(
        userId?: string,
        since?: Date
    ): Promise<{ success: boolean; documentsCreated: number; errors: string[] }> {
        const startTime = Date.now();
        const errors: string[] = [];
        let documentsCreated = 0;

        try {
            loggingService.info('Starting telemetry ingestion', {
                component: 'TelemetryIngestionService',
                userId,
                since: since?.toISOString()
            });

            // Query telemetry records with semantic content
            const query: any = {
                $or: [
                    { semantic_content: { $exists: true, $ne: '' } },
                    { cost_narrative: { $exists: true, $ne: '' } }
                ]
            };

            if (userId) {
                query.tenant_id = userId;
            }

            if (since) {
                query.timestamp = { $gte: since };
            }

            const telemetryRecords = await Telemetry.find(query)
                .sort({ timestamp: -1 })
                .limit(1000) // Process in batches
                .lean();

            loggingService.info('Found telemetry records to process', {
                component: 'TelemetryIngestionService',
                count: telemetryRecords.length
            });

            // Process each record
            for (const record of telemetryRecords) {
                try {
                    // Extract content to embed
                    const content = this.extractTelemetryContent(record);
                    
                    if (!content || content.length < 10) {
                        continue; // Skip if no meaningful content
                    }

                    // Generate content hash for deduplication
                    const contentHash = crypto
                        .createHash('sha256')
                        .update(content)
                        .digest('hex');

                    // Check if already ingested
                    const existing = await DocumentModel.findOne({
                        contentHash,
                        'metadata.source': 'telemetry',
                        'metadata.userId': record.tenant_id
                    });

                    if (existing) {
                        continue; // Already ingested
                    }

                    // Generate embedding
                    const embedding = await this.embeddings.embedQuery(content);

                    // Create document
                    await DocumentModel.create({
                        content,
                        contentHash,
                        embedding,
                        metadata: {
                            source: 'telemetry',
                            sourceType: 'telemetry',
                            userId: record.tenant_id,
                            projectId: record.workspace_id,
                            fileName: `telemetry_${record._id}`,
                            tags: this.extractTags(record),
                            customMetadata: {
                                telemetryId: record._id.toString(),
                                operationName: record.operation_name,
                                status: record.status,
                                cost: record.cost_usd,
                                timestamp: record.timestamp,
                                provider: (record as any).provider,
                                model: (record as any).model
                            }
                        },
                        chunkIndex: 0,
                        totalChunks: 1,
                        ingestedAt: new Date(),
                        status: 'active',
                        accessCount: 0
                    });

                    documentsCreated++;

                    // Update telemetry record with embedding if not already present
                    if (!record.semantic_embedding) {
                        await Telemetry.updateOne(
                            { _id: record._id },
                            { 
                                $set: { 
                                    semantic_embedding: embedding,
                                    semantic_content: content 
                                } 
                            }
                        );
                    }

                } catch (error) {
                    const errorMsg = `Failed to process telemetry ${record._id}: ${error instanceof Error ? error.message : String(error)}`;
                    errors.push(errorMsg);
                    loggingService.error(errorMsg, {
                        component: 'TelemetryIngestionService',
                        telemetryId: record._id
                    });
                }
            }

            const duration = Date.now() - startTime;

            loggingService.info('Telemetry ingestion completed', {
                component: 'TelemetryIngestionService',
                documentsCreated,
                errors: errors.length,
                duration
            });

            return {
                success: errors.length === 0,
                documentsCreated,
                errors
            };

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            loggingService.error('Telemetry ingestion failed', {
                component: 'TelemetryIngestionService',
                error: errorMsg
            });

            return {
                success: false,
                documentsCreated,
                errors: [...errors, errorMsg]
            };
        }
    }

    /**
     * Extract meaningful content from telemetry record
     */
    private extractTelemetryContent(record: any): string {
        const parts: string[] = [];

        // Add cost narrative if available
        if (record.cost_narrative) {
            parts.push(record.cost_narrative);
        }

        // Add semantic content if available
        if (record.semantic_content && record.semantic_content !== record.cost_narrative) {
            parts.push(record.semantic_content);
        }

        // Create a structured content if no narratives exist
        if (parts.length === 0) {
            const structuredContent = [
                `Operation: ${record.operation_name || 'Unknown'}`,
                `Provider: ${record.provider || 'Unknown'}`,
                `Model: ${record.model || 'Unknown'}`,
                `Status: ${record.status || 'Unknown'}`,
                `Cost: $${record.cost_usd?.toFixed(4) || '0.0000'}`,
                record.input_tokens ? `Input Tokens: ${record.input_tokens}` : null,
                record.output_tokens ? `Output Tokens: ${record.output_tokens}` : null,
                record.total_tokens ? `Total Tokens: ${record.total_tokens}` : null
            ].filter(Boolean).join('\n');

            parts.push(structuredContent);
        }

        return parts.join('\n\n');
    }

    /**
     * Extract tags from telemetry record
     */
    private extractTags(record: any): string[] {
        const tags: string[] = ['telemetry'];

        if (record.operation_name) {
            tags.push(record.operation_name);
        }

        if (record.provider) {
            tags.push(`provider:${record.provider}`);
        }

        if (record.model) {
            tags.push(`model:${record.model}`);
        }

        if (record.status) {
            tags.push(`status:${record.status}`);
        }

        // Add cost bracket
        if (record.cost_usd !== undefined) {
            if (record.cost_usd > 1) {
                tags.push('high-cost');
            } else if (record.cost_usd > 0.1) {
                tags.push('medium-cost');
            } else {
                tags.push('low-cost');
            }
        }

        return tags;
    }

    /**
     * Clean up old telemetry documents (older than retention period)
     */
    async cleanupOldTelemetry(retentionDays: number = 90): Promise<number> {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

            const result = await DocumentModel.updateMany(
                {
                    'metadata.source': 'telemetry',
                    ingestedAt: { $lt: cutoffDate }
                },
                {
                    $set: { status: 'archived' }
                }
            );

            loggingService.info('Cleaned up old telemetry documents', {
                component: 'TelemetryIngestionService',
                documentsArchived: result.modifiedCount,
                cutoffDate: cutoffDate.toISOString()
            });

            return result.modifiedCount;

        } catch (error) {
            loggingService.error('Failed to cleanup old telemetry', {
                component: 'TelemetryIngestionService',
                error: error instanceof Error ? error.message : String(error)
            });
            return 0;
        }
    }
}

// Singleton instance
export const telemetryIngestionService = new TelemetryIngestionService();

