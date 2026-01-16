import { VectorStore } from '@langchain/core/vectorstores';
import { Document as LangchainDocument } from '@langchain/core/documents';
import { Embeddings } from '@langchain/core/embeddings';
import { DocumentModel, IDocument } from '../models/Document';
import { loggingService } from './logging.service';
import mongoose from 'mongoose';
import * as crypto from 'crypto';

export interface MongoDBVectorStoreConfig {
    collectionName?: string;
    indexName?: string;
    textKey?: string;
    embeddingKey?: string;
    metadataKey?: string;
}

/**
 * Custom MongoDB VectorStore wrapper for LangChain integration
 * Preserves existing Document schema and user isolation
 * 
 * @deprecated MongoDB vector search is deprecated in favor of FAISS.
 * Use VectorStrategyService instead for all vector operations.
 * This service is maintained only for backward compatibility.
 * 
 * Migration path:
 * 1. Enable FAISS dual-write (ENABLE_FAISS_DUAL_WRITE=true)
 * 2. Run migration script: npm run migrate:faiss
 * 3. Enable shadow read for validation (ENABLE_FAISS_SHADOW_READ=true)
 * 4. Enable FAISS as primary (ENABLE_FAISS_PRIMARY=true)
 * 5. Drop MongoDB vector indexes after confirming FAISS works
 */
export class MongoDBVectorStore extends VectorStore {
    private collectionName: string;
    private indexName: string;
    private textKey: string;
    private embeddingKey: string;
    private metadataKey: string;

    _vectorstoreType(): string {
        return 'mongodb';
    }

    vectorstoreType(): string {
        return 'mongodb';
    }

    constructor(
        embeddings: Embeddings,
        config: MongoDBVectorStoreConfig = {}
    ) {
        super(embeddings, config);
        this.collectionName = config.collectionName ?? 'documents';
        this.indexName = config.indexName ?? process.env.MONGODB_VECTOR_INDEX_NAME ?? 'document_vector_index';
        this.textKey = config.textKey ?? 'content';
        this.embeddingKey = config.embeddingKey ?? 'embedding';
        this.metadataKey = config.metadataKey ?? 'metadata';
    }

    /**
     * Add documents to MongoDB with embeddings
     */
    async addDocuments(
        documents: LangchainDocument[],
        options?: { 
            ids?: string[];
            userId?: string;
            projectId?: string;
            documentId?: string;
        }
    ): Promise<string[]> {
        const startTime = Date.now();
        const ids: string[] = [];

        try {
            loggingService.info('Adding documents to MongoDB VectorStore', {
                component: 'MongoDBVectorStore',
                operation: 'addDocuments',
                documentCount: documents.length,
                userId: options?.userId
            });

            // Generate embeddings for all documents
            // Filter out empty documents to prevent AWS Bedrock validation errors
            const texts = documents.map(doc => doc.pageContent);
            const validIndices = texts
                .map((text, idx) => ({ text, idx }))
                .filter(({ text }) => text && text.trim().length > 0)
                .map(({ idx }) => idx);

            if (validIndices.length === 0) {
                loggingService.warn('No valid documents to embed, all documents are empty');
                // Return empty embeddings for all documents
                const ids: string[] = [];
                documents.forEach((_, idx) => {
                    ids.push(options?.ids?.[idx] ?? new mongoose.Types.ObjectId().toString());
                });
                return ids;
            }

            // Generate embeddings only for valid documents
            const validTexts = validIndices.map(idx => texts[idx].trim());
            const validEmbeddings = await this.embeddings.embedDocuments(validTexts);

            // Map embeddings back to original document positions
            const embeddings: number[][] = new Array(documents.length);
            let embeddingIdx = 0;
            for (let i = 0; i < documents.length; i++) {
                if (validIndices.includes(i)) {
                    embeddings[i] = validEmbeddings[embeddingIdx++];
                } else {
                    embeddings[i] = []; // Empty embedding for empty documents
                }
            }

            // Prepare documents for insertion
            const docsToInsert: Partial<IDocument>[] = documents.map((doc, idx) => {
                const contentHash = this.generateContentHash(doc.pageContent);
                const docId = options?.ids?.[idx] ?? new mongoose.Types.ObjectId().toString();
                ids.push(docId);

                // Merge metadata with options
                // IMPORTANT: Don't spread doc.metadata.source - it contains file path, not enum value
                const {source: _sourceIgnored, ...restMetadata} = doc.metadata || {};
                const metadata: IDocument['metadata'] = {
                    userId: options?.userId ?? doc.metadata?.userId ?? '',
                    projectId: options?.projectId ?? doc.metadata?.projectId,
                    documentId: options?.documentId ?? doc.metadata?.documentId,
                    source: 'user-upload' as const, // Always use enum value, not file path
                    sourceType: doc.metadata?.sourceType ?? 'text',
                    fileName: restMetadata.fileName,
                    fileType: restMetadata.fileType,
                    fileSize: restMetadata.fileSize,
                    tags: restMetadata.tags,
                    language: restMetadata.language,
                    customMetadata: restMetadata.customMetadata
                };

                return {
                    _id: new mongoose.Types.ObjectId(docId),
                    content: doc.pageContent,
                    contentHash,
                    embedding: embeddings[idx],
                    metadata,
                    chunkIndex: doc.metadata?.chunkIndex ?? idx,
                    totalChunks: doc.metadata?.totalChunks ?? documents.length,
                    ingestedAt: new Date(),
                    status: 'active' as const,
                    accessCount: 0
                };
            });

            // 🔵 DEBUG: Log what we're about to insert
            loggingService.info('🔵 [LANGCHAIN] ABOUT TO INSERT DOCUMENTS', {
                component: 'MongoDBVectorStore',
                operation: 'addDocuments',
                documentsCount: docsToInsert.length,
                firstDocument: docsToInsert[0] ? {
                    _id: docsToInsert[0]._id?.toString(),
                    userId: docsToInsert[0].metadata?.userId,
                    userIdType: typeof docsToInsert[0].metadata?.userId,
                    documentId: docsToInsert[0].metadata?.documentId,
                    fileName: docsToInsert[0].metadata?.fileName,
                    source: docsToInsert[0].metadata?.source,
                    sourceType: docsToInsert[0].metadata?.sourceType,
                    embeddingLength: docsToInsert[0].embedding?.length,
                    status: docsToInsert[0].status,
                    hasContent: !!docsToInsert[0].content,
                    contentLength: docsToInsert[0].content?.length,
                    hasContentHash: !!docsToInsert[0].contentHash,
                    hasIngestedAt: !!docsToInsert[0].ingestedAt,
                    chunkIndex: docsToInsert[0].chunkIndex,
                    totalChunks: docsToInsert[0].totalChunks
                } : null
            });

            // Insert documents with duplicate handling
            try {
                loggingService.info('🔵 [LANGCHAIN] Calling DocumentModel.insertMany', {
                    component: 'MongoDBVectorStore',
                    documentsCount: docsToInsert.length
                });

                // 🔍 VALIDATE: Try inserting first document alone to see exact error
                if (docsToInsert.length > 0) {
                    loggingService.info('🔵 [LANGCHAIN] Testing single document insert first...', {
                        component: 'MongoDBVectorStore'
                    });
                    
                    try {
                        const singleResult = await DocumentModel.create(docsToInsert[0]);
                        loggingService.info('✅ [LANGCHAIN] SINGLE DOCUMENT TEST PASSED!', {
                            component: 'MongoDBVectorStore',
                            insertedId: singleResult._id?.toString(),
                            documentId: singleResult.metadata?.documentId
                        });
                        
                        // If single insert worked, continue with the rest
                        if (docsToInsert.length > 1) {
                            const remainingDocs = docsToInsert.slice(1);
                            const remainingResults = await DocumentModel.insertMany(remainingDocs, { ordered: false });
                            loggingService.info('✅ [LANGCHAIN] Remaining documents inserted!', {
                                component: 'MongoDBVectorStore',
                                insertedCount: remainingResults.length + 1
                            });
                            return [singleResult._id?.toString() ?? '', ...remainingResults.map(r => r._id?.toString() ?? '')];
                        }
                        
                        return [singleResult._id?.toString() ?? ''] as string[];
                        
                    } catch (singleError) {
                        const err = singleError as any;
                        loggingService.error('🔴 [LANGCHAIN] SINGLE DOCUMENT INSERT FAILED!', {
                            component: 'MongoDBVectorStore',
                            errorName: err.name,
                            errorMessage: err.message,
                            errorCode: err.code,
                            validationErrors: err.errors ? Object.keys(err.errors).map(k => ({
                                field: k,
                                message: err.errors[k].message
                            })) : null
                        });
                        throw singleError;
                    }
                }

                // insertMany with ordered:false returns successfully even if some/all docs fail
                // We need to catch and inspect any returned errors
                let result: IDocument[] = [];
                let hadErrors = false;
                
                try {
                    result = await DocumentModel.insertMany(docsToInsert, { ordered: false });
                } catch (bulkError) {
                    const err = bulkError as any;
                    // MongoDB bulk insert can throw with insertedDocs still populated
                    hadErrors = true;
                    result = err.insertedDocs || [];
                    
                    loggingService.error('🔴 [LANGCHAIN] BULK INSERT ERROR CAUGHT!', {
                        component: 'MongoDBVectorStore',
                        operation: 'addDocuments',
                        errorName: err.name,
                        errorCode: err.code,
                        writeErrorsCount: err.writeErrors?.length || 0,
                        insertedCount: result.length,
                        attemptedCount: docsToInsert.length,
                        firstWriteError: err.writeErrors?.[0] ? {
                            code: err.writeErrors[0].code,
                            index: err.writeErrors[0].index,
                            errmsg: err.writeErrors[0].errmsg?.substring(0, 500)
                        } : null
                    });
                }
                
                loggingService.info('🟢 [LANGCHAIN] DOCUMENTS INSERTED SUCCESSFULLY!', {
                    component: 'MongoDBVectorStore',
                    operation: 'addDocuments',
                    inserted: result.length,
                    hadErrors,
                    firstDocId: result[0]?._id?.toString()
                });

                // 🔍 IMMEDIATE VERIFICATION
                if (result.length > 0 && result[0]?.metadata?.documentId) {
                    const verifyQuery = {
                        'metadata.documentId': result[0].metadata.documentId,
                        'metadata.userId': result[0].metadata.userId,
                        status: 'active'
                    };
                    
                    const verifyCount = await DocumentModel.countDocuments(verifyQuery);
                    
                    if (verifyCount === result.length) {
                        loggingService.info('🟢 [LANGCHAIN] VERIFICATION SUCCESS - Documents queryable!', {
                            component: 'MongoDBVectorStore',
                            expectedCount: result.length,
                            foundCount: verifyCount,
                            documentId: result[0]?.metadata?.documentId,
                            userId: result[0]?.metadata?.userId
                        });
                    } else {
                        loggingService.error('🔴 [LANGCHAIN] VERIFICATION FAILED - Documents NOT queryable!', {
                            component: 'MongoDBVectorStore',
                            expectedCount: result.length,
                            foundCount: verifyCount,
                            documentId: result[0]?.metadata?.documentId,
                            userId: result[0]?.metadata?.userId,
                            query: verifyQuery
                        });
                    }
                } else {
                    loggingService.error('🔴 [LANGCHAIN] CRITICAL: NO DOCUMENTS INSERTED!', {
                        component: 'MongoDBVectorStore',
                        operation: 'addDocuments',
                        attemptedCount: docsToInsert.length,
                        insertedCount: result.length,
                        reason: 'insertMany returned empty array - likely all duplicates or silent failure'
                    });
                }
            } catch (error) {
                // Handle duplicate key errors gracefully
                const err = error as any;
                if (err.code === 11000 || err.writeErrors) {
                    const writeErrors = err.writeErrors || [];
                    const successfulInserts = docsToInsert.length - writeErrors.length;
                    
                    loggingService.error('🔴 [LANGCHAIN] DUPLICATE KEY ERRORS DURING INSERT!', {
                        component: 'MongoDBVectorStore',
                        operation: 'addDocuments',
                        totalAttempted: docsToInsert.length,
                        successfulInserts,
                        duplicates: writeErrors.length,
                        errorCode: err.code,
                        firstError: writeErrors[0] ? {
                            index: writeErrors[0].index,
                            code: writeErrors[0].code,
                            errmsg: writeErrors[0].errmsg?.substring(0, 300)
                        } : null,
                        sampleDoc: docsToInsert[0] ? {
                            documentId: docsToInsert[0].metadata?.documentId,
                            userId: docsToInsert[0].metadata?.userId,
                            contentHash: docsToInsert[0].contentHash?.substring(0, 20)
                        } : null
                    });
                } else {
                    throw error;
                }
            }

            const duration = Date.now() - startTime;
            loggingService.info('Documents added successfully', {
                component: 'MongoDBVectorStore',
                operation: 'addDocuments',
                documentCount: documents.length,
                duration,
                sampleMetadata: docsToInsert.length > 0 ? {
                    documentId: docsToInsert[0]?.metadata?.documentId,
                    userId: docsToInsert[0]?.metadata?.userId,
                    source: docsToInsert[0]?.metadata?.source
                } : 'none'
            });

            return ids;
        } catch (error) {
            loggingService.error('Failed to add documents', {
                component: 'MongoDBVectorStore',
                operation: 'addDocuments',
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Add vectors directly (when embeddings are pre-computed)
     */
    async addVectors(
        vectors: number[][],
        documents: LangchainDocument[],
        options?: {
            ids?: string[];
            userId?: string;
            projectId?: string;
        }
    ): Promise<string[]> {
        const ids: string[] = [];

        try {
            const docsToInsert: Partial<IDocument>[] = documents.map((doc, idx) => {
                const contentHash = this.generateContentHash(doc.pageContent);
                const docId = options?.ids?.[idx] ?? new mongoose.Types.ObjectId().toString();
                ids.push(docId);

                const metadata = {
                    ...doc.metadata,
                    userId: options?.userId ?? doc.metadata?.userId,
                    projectId: options?.projectId ?? doc.metadata?.projectId,
                    source: doc.metadata?.source ?? 'user-upload',
                    sourceType: doc.metadata?.sourceType ?? 'text'
                };

                return {
                    _id: new mongoose.Types.ObjectId(docId),
                    content: doc.pageContent,
                    contentHash,
                    embedding: vectors[idx],
                    metadata,
                    chunkIndex: doc.metadata?.chunkIndex ?? idx,
                    totalChunks: doc.metadata?.totalChunks ?? documents.length,
                    ingestedAt: new Date(),
                    status: 'active',
                    accessCount: 0
                };
            });

            await DocumentModel.insertMany(docsToInsert, { ordered: false });
            return ids;
        } catch (error) {
            loggingService.error('Failed to add vectors', {
                component: 'MongoDBVectorStore',
                operation: 'addVectors',
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Similarity search with scores using MongoDB Atlas Vector Search
     */
    async similaritySearchWithScore(
        query: string,
        k: number = 4,
        filter?: any
    ): Promise<[LangchainDocument, number][]> {
        try {
            loggingService.info('Performing similarity search', {
                component: 'MongoDBVectorStore',
                operation: 'similaritySearchWithScore',
                query: query.substring(0, 100),
                limit: k,
                filter
            });

            // Validate query before embedding
            if (!query || query.trim().length === 0) {
                loggingService.warn('Empty query provided to similaritySearchWithScore, returning empty results');
                return [];
            }

            // Generate query embedding
            const queryEmbedding = await this.embeddings.embedQuery(query.trim());

            // Build MongoDB aggregation pipeline
            const pipeline: any[] = [
                {
                    $vectorSearch: {
                        index: this.indexName,
                        path: this.embeddingKey,
                        queryVector: queryEmbedding,
                        numCandidates: k * 10,
                        limit: k,
                        filter: {
                            status: { $eq: 'active' },
                            ...filter
                        }
                    }
                },
                {
                    $project: {
                        content: 1,
                        metadata: 1,
                        score: { $meta: 'vectorSearchScore' }
                    }
                }
            ];

            const results = await DocumentModel.aggregate(pipeline) as Array<{
                content: string;
                metadata: Record<string, any>;
                score: number;
            }>;

            // Convert to LangChain Document format
            const documents: [LangchainDocument, number][] = results.map(doc => {
                const langchainDoc = new LangchainDocument({
                    pageContent: doc.content,
                    metadata: doc.metadata
                });
                return [langchainDoc, doc.score];
            });

            loggingService.info('Similarity search completed', {
                component: 'MongoDBVectorStore',
                operation: 'similaritySearchWithScore',
                resultsFound: documents.length
            });

            return documents;
        } catch (error) {
            loggingService.error('Similarity search failed', {
                component: 'MongoDBVectorStore',
                operation: 'similaritySearchWithScore',
                error: error instanceof Error ? error.message : String(error)
            });
            
            // Fallback to empty results if vector search fails
            return [];
        }
    }

    /**
     * Similarity search without scores
     */
    async similaritySearch(
        query: string,
        k: number = 4,
        filter?: any
    ): Promise<LangchainDocument[]> {
        const results = await this.similaritySearchWithScore(query, k, filter);
        return results.map(([doc]) => doc);
    }

    /**
     * Similarity search by vector
     */
    async similaritySearchVectorWithScore(
        query: number[],
        k: number,
        filter?: any
    ): Promise<[LangchainDocument, number][]> {
        try {
            const pipeline: any[] = [
                {
                    $vectorSearch: {
                        index: this.indexName,
                        path: this.embeddingKey,
                        queryVector: query,
                        numCandidates: k * 10,
                        limit: k,
                        filter: {
                            status: { $eq: 'active' },
                            ...filter
                        }
                    }
                },
                {
                    $project: {
                        content: 1,
                        metadata: 1,
                        score: { $meta: 'vectorSearchScore' }
                    }
                }
            ];

            const results = await DocumentModel.aggregate(pipeline) as Array<{
                content: string;
                metadata: Record<string, any>;
                score: number;
            }>;

            return results.map(doc => {
                const langchainDoc = new LangchainDocument({
                    pageContent: doc.content,
                    metadata: doc.metadata
                });
                return [langchainDoc, doc.score];
            });
        } catch (error) {
            loggingService.error('Vector similarity search failed', {
                component: 'MongoDBVectorStore',
                operation: 'similaritySearchVectorWithScore',
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    }

    /**
     * Delete documents by IDs
     */
    async delete(params: { ids?: string[]; filter?: any }): Promise<void> {
        try {
            let deleteQuery: any = { status: 'active' };

            if (params.ids && params.ids.length > 0) {
                deleteQuery._id = { 
                    $in: params.ids.map(id => new mongoose.Types.ObjectId(id)) 
                };
            }

            if (params.filter) {
                deleteQuery = { ...deleteQuery, ...params.filter };
            }

            // Soft delete by updating status
            const result = await DocumentModel.updateMany(
                deleteQuery,
                { $set: { status: 'deleted' } }
            );

            loggingService.info('Documents deleted', {
                component: 'MongoDBVectorStore',
                operation: 'delete',
                deletedCount: result.modifiedCount
            });
        } catch (error) {
            loggingService.error('Failed to delete documents', {
                component: 'MongoDBVectorStore',
                operation: 'delete',
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Create a vector store from documents
     */
    static async fromDocuments(
        docs: LangchainDocument[],
        embeddings: Embeddings,
        dbConfig?: MongoDBVectorStoreConfig & {
            userId?: string;
            projectId?: string;
        }
    ): Promise<MongoDBVectorStore> {
        const store = new MongoDBVectorStore(embeddings, dbConfig);
        await store.addDocuments(docs, {
            userId: dbConfig?.userId,
            projectId: dbConfig?.projectId
        });
        return store;
    }

    /**
     * Create a vector store from texts
     */
    static async fromTexts(
        texts: string[],
        metadatas: object[] | object,
        embeddings: Embeddings,
        dbConfig?: MongoDBVectorStoreConfig & {
            userId?: string;
            projectId?: string;
        }
    ): Promise<MongoDBVectorStore> {
        const docs: LangchainDocument[] = texts.map((text, idx) => {
            const metadata = Array.isArray(metadatas) ? metadatas[idx] : metadatas;
            return new LangchainDocument({
                pageContent: text,
                metadata
            });
        });

        return MongoDBVectorStore.fromDocuments(docs, embeddings, dbConfig);
    }

    /**
     * Create an empty vector store
     */
    static fromExistingIndex(
        embeddings: Embeddings,
        dbConfig?: MongoDBVectorStoreConfig
    ): MongoDBVectorStore {
        return new MongoDBVectorStore(embeddings, dbConfig);
    }

    /**
     * Generate content hash for deduplication
     */
    private generateContentHash(content: string): string {
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    /**
     * Get retriever interface for this vector store
     */
    asRetriever(k?: number, filter?: any, callbacks?: any, tags?: string[], metadata?: Record<string, any>, verbose?: boolean) {
        return super.asRetriever({
            k: k ?? 4,
            filter,
            callbacks,
            tags,
            metadata,
            verbose
        });
    }

    /**
     * Max marginal relevance search - balances relevance and diversity
     */
    async maxMarginalRelevanceSearch(
        query: string,
        options: {
            k?: number;
            fetchK?: number;
            lambda?: number;
            filter?: any;
        } = {}
    ): Promise<LangchainDocument[]> {
        const { k = 4, fetchK = 20, lambda = 0.5, filter } = options;

        // Fetch more candidates than needed
        const candidatesWithScores = await this.similaritySearchWithScore(query, fetchK, filter);
        
        if (candidatesWithScores.length === 0) return [];

        // Get embeddings for all candidate documents
        const candidateEmbeddings: number[][] = [];
        for (const [doc] of candidatesWithScores) {
            // Fetch the actual embedding from the database
            const docRecord = await DocumentModel.findOne({
                content: doc.pageContent,
                'metadata.userId': doc.metadata?.userId
            }).select('embedding');
            
            if (docRecord?.embedding) {
                candidateEmbeddings.push(docRecord.embedding);
            } else {
                // Fallback: generate embedding if not found
                // Validate content before embedding
                if (doc.pageContent && doc.pageContent.trim().length > 0) {
                    const embedding = await this.embeddings.embedQuery(doc.pageContent.trim());
                    candidateEmbeddings.push(embedding);
                } else {
                    // Skip empty documents
                    candidateEmbeddings.push([]);
                }
            }
        }

        // Get query embedding
        // Validate query before embedding
        if (!query || query.trim().length === 0) {
            loggingService.warn('Empty query provided to maxMarginalRelevanceSearch');
            return [];
        }
        
        const queryEmbedding = await this.embeddings.embedQuery(query.trim());
        
        // MMR algorithm implementation with proper diversity calculation
        const selected: LangchainDocument[] = [];
        const selectedEmbeddings: number[][] = [];
        const selectedIndices = new Set<number>();

        while (selected.length < k && selectedIndices.size < candidatesWithScores.length) {
            let bestScore = -Infinity;
            let bestIdx = -1;

            for (let i = 0; i < candidatesWithScores.length; i++) {
                if (selectedIndices.has(i)) continue;

                const [, _] = candidatesWithScores[i];
                const candidateEmbedding = candidateEmbeddings[i];
                
                // Calculate relevance score (similarity to query)
                const relevanceScore = this.cosineSimilarity(queryEmbedding, candidateEmbedding);
                
                // Calculate diversity score (minimum similarity to already selected docs)
                let diversityScore = 1.0;
                if (selectedEmbeddings.length > 0) {
                    const similarities = selectedEmbeddings.map(selectedEmb => 
                        this.cosineSimilarity(candidateEmbedding, selectedEmb)
                    );
                    // Diversity is inverse of max similarity to selected docs
                    diversityScore = 1.0 - Math.max(...similarities);
                }

                // MMR score = λ * relevance + (1 - λ) * diversity
                const mmrScore = lambda * relevanceScore + (1 - lambda) * diversityScore;

                if (mmrScore > bestScore) {
                    bestScore = mmrScore;
                    bestIdx = i;
                }
            }

            if (bestIdx !== -1) {
                selected.push(candidatesWithScores[bestIdx][0]);
                selectedEmbeddings.push(candidateEmbeddings[bestIdx]);
                selectedIndices.add(bestIdx);
            } else {
                break;
            }
        }

        loggingService.info('MMR search completed', {
            component: 'MongoDBVectorStore',
            operation: 'maxMarginalRelevanceSearch',
            candidatesCount: candidatesWithScores.length,
            selectedCount: selected.length,
            lambda
        });

        return selected;
    }

    /**
     * Calculate cosine similarity between two vectors
     */
    private cosineSimilarity(vec1: number[], vec2: number[]): number {
        if (vec1.length !== vec2.length) {
            throw new Error('Vectors must have the same dimension');
        }

        let dotProduct = 0;
        let norm1 = 0;
        let norm2 = 0;

        for (let i = 0; i < vec1.length; i++) {
            dotProduct += vec1[i] * vec2[i];
            norm1 += vec1[i] * vec1[i];
            norm2 += vec2[i] * vec2[i];
        }

        norm1 = Math.sqrt(norm1);
        norm2 = Math.sqrt(norm2);

        if (norm1 === 0 || norm2 === 0) {
            return 0;
        }

        return dotProduct / (norm1 * norm2);
    }
}

// Export singleton instance with default embeddings
export const createMongoDBVectorStore = (
    embeddings: Embeddings,
    config?: MongoDBVectorStoreConfig
): MongoDBVectorStore => {
    return new MongoDBVectorStore(embeddings, config);
};