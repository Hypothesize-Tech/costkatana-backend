import { MetadataEnrichmentService } from '../metadataEnrichment.service';
import { EnrichmentContext } from '../../types/metadata.types';

/**
 * Unit Tests for Metadata Enrichment Service
 * 
 * These tests verify that the metadata enrichment service correctly extracts
 * semantic metadata from document content.
 */

describe('MetadataEnrichmentService', () => {
    let service: MetadataEnrichmentService;

    beforeEach(() => {
        service = new MetadataEnrichmentService();
    });

    describe('enrichMetadata', () => {
        it('should extract topics from content', async () => {
            const content = `
                This document explains prompt optimization techniques for AI models.
                We cover strategies for reducing token usage and improving response quality.
                Topics include prompt engineering, context management, and cost optimization.
            `;

            const result = await service.enrichMetadata(content);

            expect(result.enrichedMetadata.topics).toBeDefined();
            expect(result.enrichedMetadata.topics?.length).toBeGreaterThan(0);
            expect(result.enrichedMetadata.topics?.some(
                topic => topic.toLowerCase().includes('prompt') || topic.toLowerCase().includes('optimization')
            )).toBe(true);
        });

        it('should classify code content correctly', async () => {
            const codeContent = `
                function calculateCost(tokens: number, rate: number): number {
                    return tokens * rate;
                }

                class CostTracker {
                    private total = 0;
                    
                    addCost(amount: number) {
                        this.total += amount;
                    }
                }
            `;

            const result = await service.enrichMetadata(codeContent);

            expect(result.enrichedMetadata.contentType).toBe('code');
            expect(result.enrichedMetadata.containsCode).toBe(true);
        });

        it('should detect technical level correctly', async () => {
            const beginnerContent = `
                Getting started with Cost Katana is easy! 
                This simple tutorial will help you understand the basics.
                We'll cover the fundamental concepts in an easy-to-follow way.
            `;

            const advancedContent = `
                Implementing distributed consensus using the Raft protocol requires
                understanding of distributed systems architecture, leader election algorithms,
                and log replication mechanisms for fault-tolerant state machines.
            `;

            const beginnerResult = await service.enrichMetadata(beginnerContent);
            const advancedResult = await service.enrichMetadata(advancedContent);

            expect(beginnerResult.enrichedMetadata.technicalLevel).toBe('beginner');
            expect(advancedResult.enrichedMetadata.technicalLevel).toBe('advanced');
        });

        it('should assess quality score', async () => {
            const highQualityContent = `
                # Comprehensive Guide to AI Cost Optimization

                ## Introduction
                This guide provides detailed strategies for optimizing AI API costs...

                ## Key Strategies
                1. Prompt optimization
                2. Model selection
                3. Caching strategies

                \`\`\`typescript
                const optimizer = new CostOptimizer();
                \`\`\`

                ## Conclusion
                By following these strategies, you can reduce costs by up to 70%.
            `;

            const lowQualityContent = 'This is short.';

            const highQualityResult = await service.enrichMetadata(highQualityContent);
            const lowQualityResult = await service.enrichMetadata(lowQualityContent);

            expect(highQualityResult.enrichedMetadata.qualityScore).toBeGreaterThan(0.5);
            expect(lowQualityResult.enrichedMetadata.qualityScore).toBeLessThanOrEqual(0.6);
        });

        it('should determine importance level', async () => {
            const criticalContent = `
                CRITICAL: This is a required step for system security.
                It is important to follow these instructions carefully.
            `;

            const optionalContent = `
                This is an optional advanced feature that you may want to explore.
            `;

            const criticalResult = await service.enrichMetadata(criticalContent);
            const optionalResult = await service.enrichMetadata(optionalContent);

            expect(criticalResult.enrichedMetadata.importance).toBe('critical');
            expect(optionalResult.enrichedMetadata.importance).toBe('low');
        });

        it('should detect domain correctly', async () => {
            const aiContent = `
                Optimizing LLM prompts for better model performance and reduced token usage.
            `;

            const costContent = `
                Track your budget and monitor spending across all projects.
            `;

            const apiContent = `
                Making API requests to external endpoints and handling responses.
            `;

            const aiResult = await service.enrichMetadata(aiContent);
            const costResult = await service.enrichMetadata(costContent);
            const apiResult = await service.enrichMetadata(apiContent);

            expect(aiResult.enrichedMetadata.domain).toBe('ai-optimization');
            expect(costResult.enrichedMetadata.domain).toBe('cost-tracking');
            expect(apiResult.enrichedMetadata.domain).toBe('api-usage');
        });

        it('should detect content indicators', async () => {
            const contentWithLinks = `
                Check out https://example.com for more information.
                Visit https://docs.example.com for documentation.
            `;

            const contentWithEquations = `
                The formula is: $$ E = mc^2 $$
                And another: \\( a^2 + b^2 = c^2 \\)
            `;

            const linksResult = await service.enrichMetadata(contentWithLinks);
            const equationsResult = await service.enrichMetadata(contentWithEquations);

            expect(linksResult.enrichedMetadata.containsLinks).toBeDefined();
            expect(linksResult.enrichedMetadata.containsLinks?.length).toBeGreaterThan(0);
            expect(equationsResult.enrichedMetadata.containsEquations).toBe(true);
        });

        it('should handle enrichment context', async () => {
            const content = 'Sample content for testing context.';
            const context: EnrichmentContext = {
                userId: 'user123',
                projectId: 'project456',
                source: 'user-upload',
                existingTags: ['test', 'sample'],
                fileName: 'test.txt',
                language: 'typescript'
            };

            const result = await service.enrichMetadata(content, context);

            expect(result.enrichedMetadata).toBeDefined();
            expect(result.confidence).toBeGreaterThan(0);
            expect(result.processingTime).toBeGreaterThanOrEqual(0);
        });

        it('should generate semantic tags', async () => {
            const content = `
                This technical guide covers production-ready deployment strategies
                for enterprise applications with high availability requirements.
            `;

            const result = await service.enrichMetadata(content);

            expect(result.enrichedMetadata.semanticTags).toBeDefined();
            expect(result.enrichedMetadata.semanticTags?.length).toBeGreaterThan(0);
        });

        it('should set lastVerified date', async () => {
            const content = 'Test content';
            const result = await service.enrichMetadata(content);

            expect(result.enrichedMetadata.lastVerified).toBeDefined();
            expect(result.enrichedMetadata.lastVerified).toBeInstanceOf(Date);
        });

        it('should handle short content gracefully', async () => {
            const shortContent = 'Hi';

            const result = await service.enrichMetadata(shortContent);

            // Should not throw, but may have minimal enrichment
            expect(result).toBeDefined();
            expect(result.enrichedMetadata).toBeDefined();
        });

        it('should handle empty content gracefully', async () => {
            const emptyContent = '';

            const result = await service.enrichMetadata(emptyContent);

            // Should not throw
            expect(result).toBeDefined();
            expect(result.confidence).toBe(0.85); // Should still have default confidence
        });

        it('should complete enrichment in reasonable time', async () => {
            const content = 'This is a test document about AI cost optimization and prompt engineering.';
            const startTime = Date.now();

            const result = await service.enrichMetadata(content);

            const duration = Date.now() - startTime;
            
            expect(result.processingTime).toBeLessThan(15000); // Should complete within 15 seconds
            expect(duration).toBeLessThan(15000);
        });
    });
});
