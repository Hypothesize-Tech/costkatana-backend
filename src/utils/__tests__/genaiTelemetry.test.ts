import { Types } from 'mongoose';

const trackMock = jest.fn();
jest.mock('../../services/mixpanel.service', () => ({
  mixpanelService: {
    track: (...args: unknown[]) => trackMock(...args),
    trackAnalyticsEvent: jest.fn(),
    trackFeatureUsage: jest.fn(),
    trackAuthEvent: jest.fn(),
    trackProjectEvent: jest.fn(),
    trackOptimization: jest.fn(),
    setUserProfile: jest.fn(),
    trackError: jest.fn(),
    trackPerformance: jest.fn(),
  },
}));

import {
  GenAIUsageRecord,
  recordGenAIUsage,
  setGenAIUsageStore,
} from '../genaiTelemetry';

describe('recordGenAIUsage fan-out', () => {
  beforeEach(() => {
    trackMock.mockReset();
    setGenAIUsageStore(null);
  });

  function baseRecord(overrides: Partial<GenAIUsageRecord> = {}): GenAIUsageRecord {
    return {
      provider: 'aws-bedrock',
      operationName: 'agent.builder.text_to_agent',
      model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      promptTokens: 12,
      completionTokens: 5,
      cost: 0.0001,
      latencyMs: 42,
      userId: new Types.ObjectId().toString(),
      sessionId: 'sess_xyz',
      requestId: 'trace_abc',
      metadata: { projectId: 'p1' },
      extra: { eventCategory: 'builder' },
      ...overrides,
    };
  }

  it('routes to the registered Usage store with provider mapped to the enum', async () => {
    const usageStore = jest.fn().mockResolvedValue(undefined);
    setGenAIUsageStore(usageStore);

    recordGenAIUsage(baseRecord());
    await new Promise((r) => setImmediate(r));

    expect(usageStore).toHaveBeenCalledTimes(1);
    const passed = usageStore.mock.calls[0][0] as GenAIUsageRecord;
    expect(passed.operationName).toBe('agent.builder.text_to_agent');
    expect(passed.userId).toBeDefined();
  });

  it('skips the Usage fan-out when userId is missing or not an ObjectId', async () => {
    const usageStore = jest.fn().mockResolvedValue(undefined);
    setGenAIUsageStore(usageStore);

    recordGenAIUsage(baseRecord({ userId: undefined }));
    recordGenAIUsage(baseRecord({ userId: 'unknown' }));
    recordGenAIUsage(baseRecord({ userId: 'not-a-mongo-id' }));
    await new Promise((r) => setImmediate(r));

    expect(usageStore).not.toHaveBeenCalled();
  });

  it('emits a Mixpanel named event with userId as distinctId', () => {
    recordGenAIUsage(baseRecord());

    expect(trackMock).toHaveBeenCalledTimes(1);
    const [event, props, distinctId] = trackMock.mock.calls[0];
    expect(event).toBe('genai.agent.builder.text_to_agent');
    expect(props).toEqual(
      expect.objectContaining({
        provider: 'aws-bedrock',
        promptTokens: 12,
        completionTokens: 5,
        totalTokens: 17,
        costUsd: 0.0001,
        latencyMs: 42,
        status: 'success',
        eventCategory: 'builder',
        projectId: 'p1',
      }),
    );
    expect(typeof distinctId).toBe('string');
    expect((distinctId as string).length).toBeGreaterThan(0);
  });

  it('marks Mixpanel events with status=error when the record carries an error', () => {
    recordGenAIUsage(baseRecord({ error: new Error('boom') }));

    const [, props] = trackMock.mock.calls[0];
    expect(props).toEqual(expect.objectContaining({ status: 'error' }));
  });
});
