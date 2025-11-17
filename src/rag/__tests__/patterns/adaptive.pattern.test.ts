import { AdaptiveRAGPattern } from '../../patterns/adaptive.pattern';
import { RAGContext } from '../../types/rag.types';

describe('AdaptiveRAGPattern', () => {
  let adaptivePattern: AdaptiveRAGPattern;

  beforeEach(() => {
    adaptivePattern = new AdaptiveRAGPattern({
      name: 'adaptive',
      retrievalLimit: 5,
      judgeThreshold: 0.7,
      modules: {
        retrieve: { enabled: true, limit: 5 },
        read: { enabled: true, strategy: 'full' },
        memory: { enabled: true },
      },
    });
  });

  describe('execute', () => {
    it('should execute adaptive RAG pattern with retrieval', async () => {
      const context: RAGContext = {
        userId: 'test-user',
        conversationId: 'test-conv',
      };

      const result = await adaptivePattern.execute(
        'What are the latest cloud cost optimization techniques?',
        context
      );

      expect(result.success).toBe(true);
      expect(result.answer).toBeDefined();
      expect(result.metadata).toHaveProperty('pattern', 'adaptive');
      expect(result.metadata).toHaveProperty('decision');
    });

    it('should answer from parametric knowledge when appropriate', async () => {
      const context: RAGContext = {
        userId: 'test-user',
      };

      const result = await adaptivePattern.execute(
        'What is 2 + 2?',
        context
      );

      expect(result.success).toBe(true);
      expect(result.answer).toBeDefined();
    });

    it('should use hybrid approach for ambiguous queries', async () => {
      const context: RAGContext = {
        userId: 'test-user',
      };

      const result = await adaptivePattern.execute(
        'Tell me about AWS pricing and my usage',
        context
      );

      expect(result.success).toBe(true);
      expect(result.metadata).toHaveProperty('decision');
    });

    it('should track retrieval decisions', async () => {
      const context: RAGContext = {
        userId: 'test-user',
      };

      const result = await adaptivePattern.execute('What is serverless computing?', context);

      expect(result.metadata).toHaveProperty('modulesUsed');
      expect(Array.isArray(result.metadata.modulesUsed)).toBe(true);
    });
  });
});

