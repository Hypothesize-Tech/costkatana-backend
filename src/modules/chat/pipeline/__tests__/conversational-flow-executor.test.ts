/**
 * Unit tests for ConversationalFlowExecutor.
 *
 * We mock `BedrockService.invokeModel` (it's a static call inside the
 * executor) and stub the `usageModel` + `agentService` deps. The mention
 * detector is a pure regex so we exercise it directly via `run()`.
 */
import { ConversationalFlowExecutor } from '../helpers/conversational-flow-executor.service';
import { BedrockService } from '../../../bedrock/bedrock.service';
import type { DispatchParams } from '../helpers/route-dispatcher.service';

jest.mock('../../../bedrock/bedrock.service', () => ({
  BedrockService: { invokeModel: jest.fn() },
}));

const baseParams: DispatchParams = {
  userId: 'u1',
  message: 'plain factual question',
  modelId: 'anthropic.claude-3-5-haiku-20241022-v1:0',
  context: {},
  conversationId: 'c1',
  previousMessages: [],
};

function makeExecutor(overrides: {
  usageAggregateResult?: any[];
  agentResponse?: any;
} = {}): ConversationalFlowExecutor {
  const usageModel = {
    aggregate: jest
      .fn()
      .mockResolvedValue(overrides.usageAggregateResult ?? []),
  } as any;
  const agentService = {
    executeWithRouting: jest
      .fn()
      .mockResolvedValue(
        overrides.agentResponse ?? { response: 'agent fallback', metadata: {} },
      ),
  } as any;
  return new ConversationalFlowExecutor(usageModel, agentService);
}

describe('ConversationalFlowExecutor', () => {
  beforeEach(() => {
    (BedrockService.invokeModel as jest.Mock).mockReset();
  });

  it('returns direct Bedrock response when invoke succeeds', async () => {
    (BedrockService.invokeModel as jest.Mock).mockResolvedValue(
      '  Hello, I can help you reduce cost.  ',
    );
    const integrationCb = jest.fn();
    const executor = makeExecutor();

    const out = await executor.run(baseParams, Date.now(), integrationCb);

    expect(out.content).toBe('Hello, I can help you reduce cost.');
    expect(out.agentPath).toEqual(['conversational_flow', 'direct_bedrock']);
    expect(integrationCb).not.toHaveBeenCalled();
  });

  it('falls back to agentService when Bedrock returns empty', async () => {
    (BedrockService.invokeModel as jest.Mock).mockResolvedValue('   ');
    const integrationCb = jest.fn();
    const executor = makeExecutor({
      agentResponse: { response: 'agent answer', metadata: { tokensUsed: 42 } },
    });

    const out = await executor.run(baseParams, Date.now(), integrationCb);

    expect(out.content).toBe('agent answer');
    expect(out.agentPath).toEqual(['conversational_flow']);
    expect(out.metadata?.tokenCount).toBe(42);
  });

  it('falls back to agentService when Bedrock throws', async () => {
    (BedrockService.invokeModel as jest.Mock).mockRejectedValue(
      new Error('bedrock down'),
    );
    const executor = makeExecutor({
      agentResponse: { response: 'agent recovery', metadata: {} },
    });
    const out = await executor.run(baseParams, Date.now(), jest.fn());
    expect(out.content).toBe('agent recovery');
  });

  it('routes @-mention messages through the integration callback', async () => {
    const integrationCb = jest
      .fn()
      .mockResolvedValue({ content: 'integration handled' });
    const executor = makeExecutor();

    const out = await executor.run(
      { ...baseParams, message: 'check @github issues' },
      Date.now(),
      integrationCb,
    );

    expect(integrationCb).toHaveBeenCalledTimes(1);
    expect(integrationCb.mock.calls[0][2]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ integration: 'github' }),
      ]),
    );
    expect(out.content).toBe('integration handled');
    expect(BedrockService.invokeModel).not.toHaveBeenCalled();
  });

  it('uses the parsedMentions on params instead of re-running regex when present', async () => {
    const integrationCb = jest
      .fn()
      .mockResolvedValue({ content: 'integration handled' });
    const executor = makeExecutor();
    const parsedMentions: any = [
      { integration: 'mongodb', originalMention: '@mongodb' },
    ];
    await executor.run(
      { ...baseParams, message: 'plain text', parsedMentions },
      Date.now(),
      integrationCb,
    );
    expect(integrationCb.mock.calls[0][2]).toBe(parsedMentions);
  });

  it('default response when both Bedrock and agent fall through with empty', async () => {
    (BedrockService.invokeModel as jest.Mock).mockResolvedValue('   ');
    const executor = makeExecutor({ agentResponse: { metadata: {} } });
    const out = await executor.run(baseParams, Date.now(), jest.fn());
    expect(out.content).toContain('plain factual question');
  });

  it('does not throw when usage aggregation fails (stats fallback)', async () => {
    (BedrockService.invokeModel as jest.Mock).mockResolvedValue(
      'success despite missing stats',
    );
    const executor = makeExecutor();
    // override aggregate to throw
    (executor as any).usageModel = {
      aggregate: jest.fn().mockRejectedValue(new Error('mongo down')),
    };
    const out = await executor.run(baseParams, Date.now(), jest.fn());
    expect(out.content).toBe('success despite missing stats');
  });
});
