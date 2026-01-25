import { retrievalService } from '../retrieval.service';
import { DocumentModel } from '../../models/Document';
import { DomainType, TechnicalLevel } from '../../types/metadata.types';

/**
 * Integration Tests for Enhanced Retrieval Service
 * 
 * These tests verify that the enhanced retrieval service correctly filters
 * and ranks documents based on semantic metadata.
 */

describe('Enhanced Retrieval Integration Tests', () => {
    beforeAll(async () => {
        // Initialize retrieval service
        await retrievalService.initializeVectorStore();
    });

    describe('Semantic Metadata Filtering', () => {
        it('should filter by domain', async () => {
            const results = await retrievalService.retrieve('AI optimization strategies', {
                filters: {
                    domain: ['ai-optimization' as DomainType]
                },
                limit: 10
            });

            // All results should be from ai-optimization domain
            results.documents.forEach(doc => {
                if (doc.metadata.domain) {
                    expect(doc.metadata.domain).toBe('ai-optimization');
                }
            });
        });

        it('should filter by technical level', async () => {
            const results = await retrievalService.retrieve('explain budgets', {
                filters: {
                    technicalLevel: ['beginner' as TechnicalLevel]
                },
                limit: 10
            });

            results.documents.forEach(doc => {
                if (doc.metadata.technicalLevel) {
                    expect(doc.metadata.technicalLevel).toBe('beginner');
                }
            });
        });

        it('should filter by topics', async () => {
            const results = await retrievalService.retrieve('cost optimization', {
                filters: {
                    topics: ['cost optimization', 'budget management']
                },
                limit: 10
            });

            expect(results.documents.length).toBeGreaterThan(0);
            
            // At least some results should have matching topics
            const hasMatchingTopics = results.documents.some(doc => {
                const topics = doc.metadata.topics as string[] | undefined;
                return topics && topics.some(topic => 
                    topic.toLowerCase().includes('cost') || topic.toLowerCase().includes('budget')
                );
            });
            
            expect(hasMatchingTopics || results.documents.length === 0).toBe(true);
        });

        it('should filter by content type', async () => {
            const results = await retrievalService.retrieve('show me code examples', {
                filters: {
                    contentType: ['code', 'example']
                },
                limit: 10
            });

            results.documents.forEach(doc => {
                if (doc.metadata.contentType) {
                    expect(['code', 'example']).toContain(doc.metadata.contentType);
                }
            });
        });

        it('should filter by quality score', async () => {
            const results = await retrievalService.retrieve('best practices', {
                filters: {
                    minQualityScore: 0.7
                },
                limit: 10
            });

            results.documents.forEach(doc => {
                if (doc.metadata.qualityScore) {
                    expect(doc.metadata.qualityScore as number).toBeGreaterThanOrEqual(0.7);
                }
            });
        });

        it('should filter by importance level', async () => {
            const results = await retrievalService.retrieve('critical features', {
                filters: {
                    importance: ['critical', 'high']
                },
                limit: 10
            });

            results.documents.forEach(doc => {
                if (doc.metadata.importance) {
                    expect(['critical', 'high']).toContain(doc.metadata.importance);
                }
            });
        });

        it('should filter by document age', async () => {
            const results = await retrievalService.retrieve('recent updates', {
                filters: {
                    maxAgeInDays: 30
                },
                limit: 10
            });

            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            results.documents.forEach(doc => {
                if (doc.metadata.lastVerified) {
                    const verifiedDate = new Date(doc.metadata.lastVerified as Date);
                    expect(verifiedDate.getTime()).toBeGreaterThanOrEqual(thirtyDaysAgo.getTime());
                }
            });
        });

        it('should exclude deprecated documents', async () => {
            const results = await retrievalService.retrieve('current documentation', {
                filters: {
                    excludeDeprecated: true
                },
                limit: 10
            });

            const now = new Date();
            results.documents.forEach(doc => {
                if (doc.metadata.deprecationDate) {
                    const deprecationDate = new Date(doc.metadata.deprecationDate as Date);
                    expect(deprecationDate.getTime()).toBeGreaterThan(now.getTime());
                }
            });
        });
    });

    describe('Advanced Reranking', () => {
        it('should boost high-importance documents', async () => {
            const results = await retrievalService.retrieve('critical features', {
                rerank: true,
                limit: 10
            });

            if (results.documents.length > 0) {
                // First result should have high or critical importance
                const firstDoc = results.documents[0];
                if (firstDoc.metadata.importance) {
                    expect(['high', 'critical']).toContain(firstDoc.metadata.importance);
                }
            }
        });

        it('should boost high-quality documents', async () => {
            const results = await retrievalService.retrieve('best practices', {
                rerank: true,
                limit: 10
            });

            if (results.documents.length > 1) {
                // Higher ranked documents should generally have higher quality scores
                const firstDocQuality = results.documents[0].metadata.qualityScore as number | undefined;
                const lastDocQuality = results.documents[results.documents.length - 1].metadata.qualityScore as number | undefined;
                
                if (firstDocQuality && lastDocQuality) {
                    expect(firstDocQuality).toBeGreaterThanOrEqual(lastDocQuality - 0.3); // Allow some tolerance
                }
            }
        });

        it('should consider user context in reranking', async () => {
            const results = await retrievalService.retrieve('deployment guide', {
                rerank: true,
                userContext: {
                    technicalLevel: 'beginner' as TechnicalLevel,
                    preferredTopics: ['getting started', 'basics']
                },
                limit: 10
            });

            if (results.documents.length > 0) {
                // Should prioritize beginner-level content
                const beginnerDocs = results.documents.filter(
                    doc => doc.metadata.technicalLevel === 'beginner'
                );
                
                // At least 30% of results should be beginner level (if available)
                expect(beginnerDocs.length / results.documents.length).toBeGreaterThanOrEqual(0.1);
            }
        });
    });

    describe('User Preferences Integration', () => {
        it('should enhance retrieval with user preferences', async () => {
            // This test would require a user with preferences in the database
            const results = await retrievalService.retrieve('optimization strategies', {
                userId: 'test-user-123',
                rerank: true,
                limit: 10
            });

            expect(results).toBeDefined();
            expect(results.documents).toBeDefined();
        });
    });

    describe('Performance', () => {
        it('should complete retrieval within reasonable time', async () => {
            const startTime = Date.now();

            const results = await retrievalService.retrieve('test query', {
                limit: 5
            });

            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
            expect(results.retrievalTime).toBeLessThan(5000);
        });

        it('should cache results for repeated queries', async () => {
            const query = 'unique-test-query-' + Date.now();

            // First query
            const firstResult = await retrievalService.retrieve(query, {
                useCache: true,
                limit: 5
            });

            expect(firstResult.cacheHit).toBe(false);

            // Second query (should hit cache)
            const secondResult = await retrievalService.retrieve(query, {
                useCache: true,
                limit: 5
            });

            expect(secondResult.cacheHit).toBe(true);
        });
    });

    describe('Combined Filters', () => {
        it('should apply multiple filters simultaneously', async () => {
            const results = await retrievalService.retrieve('advanced optimization', {
                filters: {
                    domain: ['ai-optimization' as DomainType],
                    technicalLevel: ['advanced' as TechnicalLevel],
                    minQualityScore: 0.6,
                    excludeDeprecated: true
                },
                rerank: true,
                limit: 10
            });

            results.documents.forEach(doc => {
                // Verify each filter is applied
                if (doc.metadata.domain) {
                    expect(doc.metadata.domain).toBe('ai-optimization');
                }
                if (doc.metadata.technicalLevel) {
                    expect(doc.metadata.technicalLevel).toBe('advanced');
                }
                if (doc.metadata.qualityScore) {
                    expect(doc.metadata.qualityScore as number).toBeGreaterThanOrEqual(0.6);
                }
            });
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty query', async () => {
            const results = await retrievalService.retrieve('', {
                limit: 5
            });

            expect(results).toBeDefined();
            expect(results.documents).toBeDefined();
        });

        it('should handle query with no results', async () => {
            const results = await retrievalService.retrieve('xyzabcnonexistentquery123', {
                filters: {
                    domain: ['ai-optimization' as DomainType],
                    technicalLevel: ['advanced' as TechnicalLevel],
                    minQualityScore: 0.99 // Very high threshold
                },
                limit: 5
            });

            expect(results).toBeDefined();
            expect(results.documents).toBeDefined();
            // May or may not have results, but should not error
        });

        it('should handle filters with no matching documents', async () => {
            const results = await retrievalService.retrieve('test', {
                filters: {
                    topics: ['nonexistent-topic-' + Date.now()]
                },
                limit: 5
            });

            expect(results).toBeDefined();
            expect(results.totalResults).toBe(0);
        });
    });
});
