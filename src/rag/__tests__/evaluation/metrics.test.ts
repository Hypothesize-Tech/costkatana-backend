import { RAGEvaluator } from '../../evaluation/metrics';
import { Document } from '@langchain/core/documents';

describe('RAGEvaluator', () => {
  let evaluator: RAGEvaluator;

  beforeEach(() => {
    evaluator = new RAGEvaluator();
  });

  const createMockDocuments = (contents: string[]): Document[] => {
    return contents.map(
      (content) =>
        new Document({
          pageContent: content,
          metadata: { score: 0.8 },
        })
    );
  };

  describe('evaluate', () => {
    it('should evaluate all metrics for a RAG response', async () => {
      const documents = createMockDocuments([
        'Cost optimization involves reducing cloud spending through efficient resource usage.',
        'Best practices include using reserved instances and right-sizing resources.',
      ]);

      const result = await evaluator.evaluate({
        query: 'How to optimize cloud costs?',
        answer:
          'To optimize cloud costs, use reserved instances and right-size your resources for efficient usage.',
        documents,
      });

      expect(result.contextRelevance).toBeGreaterThanOrEqual(0);
      expect(result.contextRelevance).toBeLessThanOrEqual(1);
      expect(result.answerFaithfulness).toBeGreaterThanOrEqual(0);
      expect(result.answerRelevance).toBeGreaterThanOrEqual(0);
      expect(result.retrievalPrecision).toBeGreaterThanOrEqual(0);
      expect(result.overall).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty documents gracefully', async () => {
      const result = await evaluator.evaluate({
        query: 'What is AI?',
        answer: 'Artificial Intelligence is...',
        documents: [],
      });

      expect(result.contextRelevance).toBe(0);
      expect(result.answerFaithfulness).toBe(0);
      expect(result.retrievalPrecision).toBe(0);
    });
  });

  describe('calculateAggregateStats', () => {
    it('should calculate statistics across multiple evaluations', () => {
      const metrics = [
        {
          contextRelevance: 0.8,
          answerFaithfulness: 0.9,
          answerRelevance: 0.85,
          retrievalPrecision: 0.75,
          retrievalRecall: 0.7,
          overall: 0.82,
        },
        {
          contextRelevance: 0.7,
          answerFaithfulness: 0.8,
          answerRelevance: 0.75,
          retrievalPrecision: 0.65,
          retrievalRecall: 0.6,
          overall: 0.72,
        },
        {
          contextRelevance: 0.9,
          answerFaithfulness: 0.95,
          answerRelevance: 0.9,
          retrievalPrecision: 0.85,
          retrievalRecall: 0.8,
          overall: 0.88,
        },
      ];

      const stats = evaluator.calculateAggregateStats(metrics);

      expect(stats.mean.overall).toBeCloseTo(0.81, 1);
      expect(stats.min.overall).toBe(0.72);
      expect(stats.max.overall).toBe(0.88);
      expect(stats.std.overall).toBeGreaterThan(0);
    });
  });

  describe('batchEvaluate', () => {
    it('should evaluate multiple inputs in batch', async () => {
      const inputs = [
        {
          query: 'What is serverless?',
          answer: 'Serverless is a cloud computing model...',
          documents: createMockDocuments(['Serverless computing allows...']),
        },
        {
          query: 'What is containerization?',
          answer: 'Containerization is a method of packaging applications...',
          documents: createMockDocuments(['Containers provide isolated environments...']),
        },
      ];

      const results = await evaluator.batchEvaluate(inputs);

      expect(results).toHaveLength(2);
      results.forEach((result) => {
        expect(result.overall).toBeGreaterThanOrEqual(0);
        expect(result.overall).toBeLessThanOrEqual(1);
      });
    });
  });
});

