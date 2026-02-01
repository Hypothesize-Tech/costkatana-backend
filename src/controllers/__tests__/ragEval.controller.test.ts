/**
 * RAG Eval Controller tests.
 * Asserts batch-eval response shape and aggregate metrics.
 */

import { Response } from 'express';
import { evaluateBatch } from '../ragEval.controller';
import type { AuthenticatedRequest } from '@utils/controllerHelper';

jest.mock('../../rag', () => ({
  modularRAGOrchestrator: {
    execute: jest.fn().mockResolvedValue({
      success: true,
      answer: 'Cost optimization reduces cloud spending through efficient resource usage.',
      documents: [],
      sources: [],
      metadata: {
        pattern: 'naive',
        modulesUsed: [],
        retrievalCount: 0,
        totalDocuments: 0,
        performance: { totalDuration: 100, retrievalDuration: 50, generationDuration: 50, moduleDurations: {} },
        cacheHit: false,
      },
    }),
  },
}));

jest.mock('../../rag/evaluation', () => ({
  ragEvaluator: {
    evaluate: jest.fn().mockResolvedValue({
      contextRelevance: 0.85,
      answerFaithfulness: 0.9,
      answerRelevance: 0.88,
      retrievalPrecision: 0.8,
      retrievalRecall: 0.75,
      overall: 0.84,
    }),
    calculateAggregateStats: jest.fn().mockImplementation((metrics: Array<{ overall: number }>) => ({
      mean: { contextRelevance: 0.85, answerFaithfulness: 0.9, answerRelevance: 0.88, retrievalPrecision: 0.8, retrievalRecall: 0.75, overall: 0.84 },
      std: { contextRelevance: 0, answerFaithfulness: 0, answerRelevance: 0, retrievalPrecision: 0, retrievalRecall: 0, overall: 0 },
      min: { contextRelevance: 0.85, answerFaithfulness: 0.9, answerRelevance: 0.88, retrievalPrecision: 0.8, retrievalRecall: 0.75, overall: 0.84 },
      max: { contextRelevance: 0.85, answerFaithfulness: 0.9, answerRelevance: 0.88, retrievalPrecision: 0.8, retrievalRecall: 0.75, overall: 0.84 },
    })),
  },
}));

describe('RAG Eval Controller', () => {
  let mockReq: Partial<AuthenticatedRequest>;
  let mockRes: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    mockReq = {
      body: {
        dataset: [
          { question: 'What is cost optimization?' },
          { question: 'How to reduce cloud costs?' },
        ],
        pattern: 'naive',
      },
      userId: 'test-admin-user',
    };
    mockRes = {
      status: statusMock,
      json: jsonMock,
    };
  });

  it('should return 400 when dataset is missing', async () => {
    (mockReq as AuthenticatedRequest).body = {};
    await evaluateBatch(mockReq as AuthenticatedRequest, mockRes as Response);
    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('dataset') })
    );
  });

  it('should return 400 when dataset exceeds max size', async () => {
    const largeDataset = Array.from({ length: 51 }, (_, i) => ({ question: `q${i}` }));
    (mockReq as AuthenticatedRequest).body = { dataset: largeDataset };
    await evaluateBatch(mockReq as AuthenticatedRequest, mockRes as Response);
    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('50') })
    );
  });

  it('should return 200 with results and aggregate when dataset is valid', async () => {
    await evaluateBatch(mockReq as AuthenticatedRequest, mockRes as Response);
    expect(statusMock).toHaveBeenCalledWith(200);
    const body = jsonMock.mock.calls[0][0];
    expect(body).toHaveProperty('results');
    expect(body).toHaveProperty('aggregate');
    expect(body).toHaveProperty('totalSamples', 2);
    expect(body).toHaveProperty('failedSamples');
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.length).toBe(2);
    expect(body.aggregate).toHaveProperty('mean');
    expect(body.aggregate).toHaveProperty('std');
    expect(body.aggregate).toHaveProperty('min');
    expect(body.aggregate).toHaveProperty('max');
    expect(typeof body.aggregate.mean.overall).toBe('number');
    expect(body.aggregate.mean.overall).toBeGreaterThanOrEqual(0);
    expect(body.aggregate.mean.overall).toBeLessThanOrEqual(1);
    expect(body.results[0]).toHaveProperty('question');
    expect(body.results[0]).toHaveProperty('answer');
    expect(body.results[0]).toHaveProperty('metrics');
    expect(body.results[0]).toHaveProperty('success');
  });
});
