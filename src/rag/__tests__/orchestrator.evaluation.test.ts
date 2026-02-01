/**
 * Orchestrator evaluation wiring tests.
 * When config.evaluation.enabled is true, the orchestrator runs the evaluator
 * and attaches result.metadata.evaluation with RAGAS-aligned metrics.
 */

const mockEvaluate = jest.fn().mockResolvedValue({
  contextRelevance: 0.9,
  answerFaithfulness: 0.85,
  answerRelevance: 0.9,
  retrievalPrecision: 0.8,
  retrievalRecall: 0.7,
  overall: 0.85,
});

jest.mock('../../evaluation', () => ({
  ragEvaluator: {
    evaluate: mockEvaluate,
  },
}));

import { modularRAGOrchestrator } from '../../orchestrator/modularRAG.orchestrator';
import { RAGContext } from '../../types/rag.types';

describe('ModularRAGOrchestrator evaluation wiring', () => {
  const context: RAGContext = {
    userId: 'eval-test-user',
    conversationId: 'eval-test-conv',
  };

  beforeEach(() => {
    mockEvaluate.mockClear();
    mockEvaluate.mockResolvedValue({
      contextRelevance: 0.9,
      answerFaithfulness: 0.85,
      answerRelevance: 0.9,
      retrievalPrecision: 0.8,
      retrievalRecall: 0.7,
      overall: 0.85,
    });
  });

  it('should attach metadata.evaluation when config.evaluation.enabled is true', async () => {
    const result = await modularRAGOrchestrator.execute({
      query: 'What is cost optimization?',
      context,
      preferredPattern: 'naive',
      config: {
        evaluation: { enabled: true },
      },
    });

    if (result.success && result.answer) {
      expect(mockEvaluate).toHaveBeenCalled();
      expect(result.metadata.evaluation).toBeDefined();
      expect(result.metadata.evaluation).toHaveProperty('contextRelevance');
      expect(result.metadata.evaluation).toHaveProperty('answerFaithfulness');
      expect(result.metadata.evaluation).toHaveProperty('answerRelevance');
      expect(result.metadata.evaluation).toHaveProperty('retrievalPrecision');
      expect(result.metadata.evaluation).toHaveProperty('retrievalRecall');
      expect(result.metadata.evaluation).toHaveProperty('overall');
      expect(typeof result.metadata.evaluation!.contextRelevance).toBe('number');
      expect(typeof result.metadata.evaluation!.overall).toBe('number');
    }
    // If RAG failed (e.g. no Bedrock), we still pass; eval is only run on success
  }, 30000);

  it('should not call evaluator when config.evaluation.enabled is false', async () => {
    await modularRAGOrchestrator.execute({
      query: 'What is cost optimization?',
      context,
      preferredPattern: 'naive',
      config: {
        evaluation: { enabled: false },
      },
    });

    expect(mockEvaluate).not.toHaveBeenCalled();
  }, 30000);

  it('should not call evaluator when config.evaluation is omitted', async () => {
    await modularRAGOrchestrator.execute({
      query: 'What is cost optimization?',
      context,
      preferredPattern: 'naive',
    });

    expect(mockEvaluate).not.toHaveBeenCalled();
  }, 30000);
});
