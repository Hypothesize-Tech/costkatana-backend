import { IterativeRAGPattern } from '../../patterns/iterative.pattern';
import { RAGContext } from '../../types/rag.types';

describe('IterativeRAGPattern', () => {
  let iterativePattern: IterativeRAGPattern;

  beforeEach(() => {
    iterativePattern = new IterativeRAGPattern({
      name: 'iterative',
      maxIterations: 3,
      retrievalLimit: 5,
      convergenceThreshold: 0.9,
      modules: {
        retrieve: { enabled: true, limit: 5 },
        rewrite: { enabled: true, methods: ['reformulation'] },
        read: { enabled: true, strategy: 'summary' },
        fusion: { enabled: true, strategy: 'rrf' },
      },
    });
  });

  describe('execute', () => {
    it('should execute iterative RAG with multiple rounds', async () => {
      const context: RAGContext = {
        userId: 'test-user',
        conversationId: 'test-conv',
      };

      const result = await iterativePattern.execute(
        'Provide a comprehensive guide to cloud cost optimization',
        context
      );

      expect(result.success).toBe(true);
      expect(result.answer).toBeDefined();
      expect(result.metadata).toHaveProperty('pattern', 'iterative');
      expect(result.metadata).toHaveProperty('iterationsCompleted');
    });

    it('should converge when sufficient quality reached', async () => {
      const context: RAGContext = {
        userId: 'test-user',
      };

      const result = await iterativePattern.execute(
        'What is machine learning?',
        context
      );

      expect(result.success).toBe(true);
      expect(result.metadata.iterationsCompleted).toBeLessThanOrEqual(3);
    });

    it('should progressively refine answer', async () => {
      const context: RAGContext = {
        userId: 'test-user',
      };

      const result = await iterativePattern.execute(
        'Explain the benefits and drawbacks of microservices architecture',
        context
      );

      expect(result.success).toBe(true);
      expect(result.answer).toBeDefined();
      expect(result.answer.length).toBeGreaterThan(100);
    });

    it('should track performance across iterations', async () => {
      const context: RAGContext = {
        userId: 'test-user',
      };

      const result = await iterativePattern.execute(
        'Compare different database types',
        context
      );

      expect(result.metadata.performance).toHaveProperty('totalDuration');
      expect(result.metadata.performance).toHaveProperty('retrievalDuration');
    });
  });
});

