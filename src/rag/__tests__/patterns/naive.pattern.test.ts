import { NaiveRAGPattern } from '../../patterns/naive.pattern';
import { RAGContext } from '../../types/rag.types';

describe('NaiveRAGPattern', () => {
  let naivePattern: NaiveRAGPattern;

  beforeEach(() => {
    naivePattern = new NaiveRAGPattern({
      name: 'naive',
      retrievalLimit: 5,
      modules: {
        retrieve: { enabled: true, limit: 5 },
        read: { enabled: true, strategy: 'full' },
      },
    });
  });

  describe('execute', () => {
    it('should execute naive RAG pattern successfully', async () => {
      const context: RAGContext = {
        userId: 'test-user',
        conversationId: 'test-conv',
      };

      const result = await naivePattern.execute('What is cost optimization?', context);

      expect(result.success).toBe(true);
      expect(result.answer).toBeDefined();
      expect(result.documents).toBeDefined();
      expect(result.sources).toBeDefined();
      expect(result.metadata).toHaveProperty('pattern', 'naive');
    });

    it('should handle queries with no results', async () => {
      const context: RAGContext = {
        userId: 'test-user',
      };

      const result = await naivePattern.execute('xyzabc nonexistent query', context);

      expect(result.success).toBeDefined();
      expect(result.answer).toBeDefined();
    });

    it('should track performance metrics', async () => {
      const context: RAGContext = {
        userId: 'test-user',
      };

      const result = await naivePattern.execute('How to optimize cloud costs?', context);

      expect(result.metadata).toHaveProperty('performance');
      expect(result.metadata.performance).toHaveProperty('retrievalDuration');
      expect(result.metadata.performance).toHaveProperty('totalDuration');
    });

    it('should return sources from retrieved documents', async () => {
      const context: RAGContext = {
        userId: 'test-user',
      };

      const result = await naivePattern.execute('AI best practices', context);

      expect(Array.isArray(result.sources)).toBe(true);
    });
  });
});

