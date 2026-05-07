import {
  RouteDispatcher,
  type DispatchParams,
} from '../helpers/route-dispatcher.service';

function makeDispatcher(overrides: Partial<{
  knowledgeBase: any;
  webScraper: any;
  mcp: any;
  multiAgent: any;
}> = {}): {
  dispatcher: RouteDispatcher;
  knowledgeBase: any;
  webScraper: any;
  mcp: any;
  multiAgent: any;
} {
  const knowledgeBase = overrides.knowledgeBase ?? {
    handle: jest
      .fn()
      .mockResolvedValue({ response: 'kb-answer', agentPath: ['kb'] }),
  };
  const webScraper = overrides.webScraper ?? {
    handle: jest.fn().mockResolvedValue({
      response: 'web-answer',
      agentPath: ['web_scraper'],
    }),
  };
  const mcp = overrides.mcp ?? {
    handle: jest.fn().mockResolvedValue({
      response: 'mcp-answer',
      mongodbIntegrationData: { foo: 'bar' },
    }),
  };
  const multiAgent = overrides.multiAgent ?? {
    executeMultiAgentFlow: jest.fn().mockResolvedValue({
      response: 'multi-answer',
      agentPath: ['multi_agent'],
    }),
  };
  const dispatcher = new RouteDispatcher(
    knowledgeBase as any,
    webScraper as any,
    mcp as any,
    multiAgent as any,
  );
  return { dispatcher, knowledgeBase, webScraper, mcp, multiAgent };
}

const baseParams: DispatchParams = {
  userId: 'u1',
  message: 'hello',
  modelId: 'm',
  context: { currentSubject: 's' },
  conversationId: 'c1',
};

describe('RouteDispatcher', () => {
  it('routes knowledge_base to KnowledgeBaseHandler with userId', async () => {
    const harness = makeDispatcher();
    const fallback = jest.fn();
    const out = await harness.dispatcher.dispatch(
      'knowledge_base',
      baseParams,
      Date.now(),
      fallback,
    );
    expect(harness.knowledgeBase.handle).toHaveBeenCalled();
    expect(out.content).toBe('kb-answer');
    expect(fallback).not.toHaveBeenCalled();
  });

  it('routes web_scraper to WebScraperHandler', async () => {
    const harness = makeDispatcher();
    const fallback = jest.fn();
    const out = await harness.dispatcher.dispatch(
      'web_scraper',
      baseParams,
      Date.now(),
      fallback,
    );
    expect(harness.webScraper.handle).toHaveBeenCalled();
    expect(out.content).toBe('web-answer');
  });

  it('routes mcp through MCPHandler and propagates integration data', async () => {
    const harness = makeDispatcher();
    const fallback = jest.fn();
    const out = await harness.dispatcher.dispatch(
      'mcp',
      baseParams,
      Date.now(),
      fallback,
    );
    expect(harness.mcp.handle).toHaveBeenCalled();
    expect(out.mongodbIntegrationData).toEqual({ foo: 'bar' });
  });

  it('routes multi_agent and applies the thinking-extractor callback', async () => {
    const harness = makeDispatcher();
    const fallback = jest.fn();
    const extractor = jest
      .fn()
      .mockReturnValue({ steps: ['plan', 'execute'] });
    const out = await harness.dispatcher.dispatch(
      'multi_agent',
      baseParams,
      Date.now(),
      fallback,
      extractor,
    );
    expect(harness.multiAgent.executeMultiAgentFlow).toHaveBeenCalled();
    expect(extractor).toHaveBeenCalled();
    expect(out.agentThinking).toEqual({ steps: ['plan', 'execute'] });
    expect(out.riskLevel).toBe('medium');
  });

  it('falls through to conversational_flow callback for that route', async () => {
    const harness = makeDispatcher();
    const fallback = jest.fn().mockResolvedValue({ content: 'fallback' });
    const out = await harness.dispatcher.dispatch(
      'conversational_flow',
      baseParams,
      Date.now(),
      fallback,
    );
    expect(fallback).toHaveBeenCalledWith(baseParams, expect.any(Number));
    expect(out.content).toBe('fallback');
  });

  it('falls through to conversational_flow for unknown routes (default branch)', async () => {
    const harness = makeDispatcher();
    const fallback = jest
      .fn()
      .mockResolvedValue({ content: 'unknown-fallback' });
    const out = await harness.dispatcher.dispatch(
      'something_unknown',
      baseParams,
      Date.now(),
      fallback,
    );
    expect(fallback).toHaveBeenCalled();
    expect(out.content).toBe('unknown-fallback');
  });
});
