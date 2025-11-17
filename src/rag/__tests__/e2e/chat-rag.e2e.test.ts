import { modularRAGOrchestrator } from '../../index';
import { RAGContext } from '../../types/rag.types';

describe('Chat RAG E2E Tests', () => {
  describe('Simple Queries (Naive Pattern)', () => {
    it('should handle simple factual query', async () => {
      const context: RAGContext = {
        userId: 'e2e-test-user',
        conversationId: 'e2e-test-conv-1',
      };

      const result = await modularRAGOrchestrator.execute({
        query: 'What is cost optimization?',
        context,
        preferredPattern: 'naive',
      });

      expect(result.success).toBe(true);
      expect(result.answer).toBeDefined();
      expect(result.answer.length).toBeGreaterThan(50);
      expect(result.metadata.pattern).toBe('naive');
      expect(result.documents.length).toBeGreaterThan(0);
    });

    it('should retrieve relevant documents', async () => {
      const context: RAGContext = {
        userId: 'e2e-test-user',
      };

      const result = await modularRAGOrchestrator.execute({
        query: 'How to reduce cloud costs?',
        context,
        preferredPattern: 'naive',
      });

      expect(result.success).toBe(true);
      expect(result.documents).toBeDefined();
      expect(result.sources.length).toBeGreaterThan(0);
    });
  });

  describe('Adaptive Pattern with Auto-Selection', () => {
    it('should auto-select pattern based on query complexity', async () => {
      const context: RAGContext = {
        userId: 'e2e-test-user',
        conversationId: 'e2e-test-conv-2',
      };

      const result = await modularRAGOrchestrator.execute({
        query: 'What are the best practices for AWS Lambda cost optimization?',
        context,
      });

      expect(result.success).toBe(true);
      expect(result.metadata.pattern).toBeDefined();
      expect(['naive', 'adaptive', 'iterative']).toContain(result.metadata.pattern);
    });

    it('should handle follow-up questions with conversation context', async () => {
      const context: RAGContext = {
        userId: 'e2e-test-user',
        conversationId: 'e2e-test-conv-3',
        recentMessages: [
          { role: 'user', content: 'Tell me about serverless' },
          { role: 'assistant', content: 'Serverless is a cloud computing model...' },
        ],
      };

      const result = await modularRAGOrchestrator.execute({
        query: 'How can I optimize costs for it?',
        context,
        preferredPattern: 'adaptive',
      });

      expect(result.success).toBe(true);
      expect(result.answer).toBeDefined();
    });
  });

  describe('Complex Queries (Iterative/Recursive Patterns)', () => {
    it('should handle comprehensive questions with iterative pattern', async () => {
      const context: RAGContext = {
        userId: 'e2e-test-user',
        conversationId: 'e2e-test-conv-4',
      };

      const result = await modularRAGOrchestrator.execute({
        query: 'Provide a complete guide to cloud cost optimization strategies',
        context,
        preferredPattern: 'iterative',
      });

      expect(result.success).toBe(true);
      expect(result.answer.length).toBeGreaterThan(300);
      expect(result.metadata.iterationsCompleted).toBeDefined();
    });

    it('should handle comparative questions with recursive pattern', async () => {
      const context: RAGContext = {
        userId: 'e2e-test-user',
        conversationId: 'e2e-test-conv-5',
      };

      const result = await modularRAGOrchestrator.execute({
        query: 'Compare AWS, Azure, and GCP pricing models',
        context,
        preferredPattern: 'recursive',
      });

      expect(result.success).toBe(true);
      expect(result.metadata.subQuestionsCount).toBeDefined();
      expect(result.metadata.subQuestionsCount).toBeGreaterThan(0);
    });
  });

  describe('Document Filtering', () => {
    it('should filter by specific documents', async () => {
      const context: RAGContext = {
        userId: 'e2e-test-user',
      };

      const result = await modularRAGOrchestrator.execute({
        query: 'What is in this document?',
        context,
        config: {
          modules: {
            retrieve: {
              limit: 5,
              filters: {
                documentIds: ['test-doc-1'],
              },
            },
          },
        },
      });

      expect(result.success).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle empty query gracefully', async () => {
      const context: RAGContext = {
        userId: 'e2e-test-user',
      };

      const result = await modularRAGOrchestrator.execute({
        query: '',
        context,
      });

      expect(result.success).toBeDefined();
    });

    it('should fallback on pattern failure', async () => {
      const context: RAGContext = {
        userId: 'e2e-test-user',
      };

      const result = await modularRAGOrchestrator.execute({
        query: 'test query',
        context,
        preferredPattern: 'adaptive',
      });

      expect(result.success).toBeDefined();
      expect(result.answer).toBeDefined();
    });
  });

  describe('Performance', () => {
    it('should complete within reasonable time for naive pattern', async () => {
      const context: RAGContext = {
        userId: 'e2e-test-user',
      };

      const startTime = Date.now();
      const result = await modularRAGOrchestrator.execute({
        query: 'What is machine learning?',
        context,
        preferredPattern: 'naive',
      });
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(10000); // 10 seconds
    });

    it('should track performance metrics', async () => {
      const context: RAGContext = {
        userId: 'e2e-test-user',
      };

      const result = await modularRAGOrchestrator.execute({
        query: 'Explain cloud computing',
        context,
      });

      expect(result.metadata.performance).toBeDefined();
      expect(result.metadata.performance.totalDuration).toBeGreaterThan(0);
    });
  });

  describe('Caching', () => {
    it('should use cache for repeated queries', async () => {
      const context: RAGContext = {
        userId: 'e2e-test-user-cache',
        conversationId: 'e2e-test-conv-cache',
      };

      const query = 'What is artificial intelligence?';

      // First query - cache miss
      const result1 = await modularRAGOrchestrator.execute({
        query,
        context,
        preferredPattern: 'naive',
      });

      // Second query - should hit cache
      const result2 = await modularRAGOrchestrator.execute({
        query,
        context,
        preferredPattern: 'naive',
      });

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
    });
  });
});

