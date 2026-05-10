import { EvalsDashboardService } from '../services/evals-dashboard.service';

describe('EvalsDashboardService', () => {
  function makeService(opts: {
    aggregate?: unknown[];
    feedback?: Array<{ _id: boolean; count: number }>;
  }) {
    const evalModel = {
      aggregate: jest.fn().mockResolvedValue(opts.aggregate ?? []),
    };
    const feedbackModel = {
      aggregate: jest.fn().mockResolvedValue(opts.feedback ?? []),
    };
    return {
      service: new EvalsDashboardService(
        evalModel as any,
        feedbackModel as any,
      ),
      evalModel,
      feedbackModel,
    };
  }

  it('joins evaluation aggregate with feedback ratio', async () => {
    const harness = makeService({
      aggregate: [
        {
          summary: [
            {
              totalEvaluated: 10,
              averageOverall: 0.82,
              averageContextRelevance: 0.7,
              averageAnswerFaithfulness: 0.9,
              averageAnswerRelevance: 0.85,
              averageRetrievalPrecision: 0.6,
            },
          ],
          timeline: [
            {
              date: new Date('2025-01-01'),
              count: 5,
              overall: 0.8,
              contextRelevance: 0.7,
              answerFaithfulness: 0.9,
              answerRelevance: 0.85,
              retrievalPrecision: 0.6,
            },
          ],
          byModel: [
            { modelName: 'haiku', count: 4, averageOverall: 0.81 },
          ],
          byPromptVersion: [
            {
              promptTemplateId: 'tpl1',
              promptVersionId: 'v1',
              count: 3,
              averageOverall: 0.79,
            },
          ],
        },
      ],
      feedback: [
        { _id: true, count: 8 },
        { _id: false, count: 2 },
      ],
    });

    const result = await harness.service.getDashboard({ userId: 'u1' });

    expect(result.summary.totalEvaluated).toBe(10);
    expect(result.summary.positiveCount).toBe(8);
    expect(result.summary.negativeCount).toBe(2);
    expect(result.summary.positiveRatio).toBeCloseTo(0.8, 4);
    expect(result.summary.weakestMetric).toBe('retrievalPrecision');
    expect(result.byModel).toHaveLength(1);
    expect(result.byPromptVersion).toHaveLength(1);
    expect(result.timeline).toHaveLength(1);
  });

  it('handles empty data gracefully', async () => {
    const harness = makeService({ aggregate: [], feedback: [] });
    const result = await harness.service.getDashboard({ userId: 'u1' });
    expect(result.summary.totalEvaluated).toBe(0);
    expect(result.summary.averageOverall).toBe(0);
    expect(result.summary.positiveRatio).toBe(0);
    expect(result.summary.weakestMetric).toBe(null);
    expect(result.timeline).toEqual([]);
    expect(result.byModel).toEqual([]);
    expect(result.byPromptVersion).toEqual([]);
  });

  it('forwards date and model filters into aggregation match', async () => {
    const harness = makeService({});
    const from = new Date('2025-01-01');
    const to = new Date('2025-02-01');
    await harness.service.getDashboard({
      userId: 'u1',
      from,
      to,
      modelName: 'haiku',
    });

    const callArg = harness.evalModel.aggregate.mock.calls[0][0];
    const matchStage = callArg[0].$match;
    expect(matchStage.userId).toBe('u1');
    expect(matchStage.modelName).toBe('haiku');
    expect(matchStage.createdAt.$gte).toBe(from);
    expect(matchStage.createdAt.$lte).toBe(to);
  });
});
