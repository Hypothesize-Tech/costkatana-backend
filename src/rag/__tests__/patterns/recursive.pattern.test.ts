import { RecursiveRAGPattern } from '../../patterns/recursive.pattern';
import { RAGContext } from '../../types/rag.types';

describe('RecursiveRAGPattern', () => {
  let recursivePattern: RecursiveRAGPattern;

  beforeEach(() => {
    recursivePattern = new RecursiveRAGPattern({
      name: 'recursive',
      maxDepth: 2,
      maxSubQuestions: 3,
      retrievalLimit: 3,
      modules: {
        retrieve: { enabled: true, limit: 3 },
        rewrite: { enabled: true, methods: ['decomposition'] },
        read: { enabled: true, strategy: 'summary' },
        fusion: { enabled: true, strategy: 'weighted' },
      },
    });
  });

  describe('execute', () => {
    it('should execute recursive RAG with question decomposition', async () => {
      const context: RAGContext = {
        userId: 'test-user',
        conversationId: 'test-conv',
      };

      const result = await recursivePattern.execute(
        'Compare AWS, Azure, and GCP pricing models and their cost optimization strategies',
        context
      );

      expect(result.success).toBe(true);
      expect(result.answer).toBeDefined();
      expect(result.metadata).toHaveProperty('pattern', 'recursive');
      expect(result.metadata).toHaveProperty('subQuestionsCount');
    });

    it('should handle multi-hop reasoning', async () => {
      const context: RAGContext = {
        userId: 'test-user',
      };

      const result = await recursivePattern.execute(
        'What are the prerequisites for implementing Kubernetes and how do they compare to Docker Swarm?',
        context
      );

      expect(result.success).toBe(true);
      expect(result.metadata.subQuestionsCount).toBeGreaterThan(0);
    });

    it('should synthesize sub-answers into final answer', async () => {
      const context: RAGContext = {
        userId: 'test-user',
      };

      const result = await recursivePattern.execute(
        'Explain the relationship between containerization, orchestration, and cloud-native architecture',
        context
      );

      expect(result.success).toBe(true);
      expect(result.answer).toBeDefined();
      expect(result.answer.length).toBeGreaterThan(200);
    });

    it('should collect documents from all sub-questions', async () => {
      const context: RAGContext = {
        userId: 'test-user',
      };

      const result = await recursivePattern.execute(
        'Compare NoSQL and SQL databases in terms of scalability and consistency',
        context
      );

      expect(result.documents).toBeDefined();
      expect(Array.isArray(result.documents)).toBe(true);
    });
  });
});

