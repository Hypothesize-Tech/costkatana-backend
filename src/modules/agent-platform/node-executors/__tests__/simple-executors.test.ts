import type { RunContext } from '../base-node-executor';
import { UserMessageInputExecutor } from '../user-message-input.executor';
import { ResponseOutputExecutor } from '../response-output.executor';

describe('Simple node executors', () => {
  const userMsg = new UserMessageInputExecutor();
  const respOut = new ResponseOutputExecutor();

  const ctx = (runInput: unknown): RunContext => ({
    runId: 'r1',
    agentDefinitionId: 'a1',
    agentVersionId: 'v1',
    organizationId: 'o1',
    runInput,
    outputs: {},
    memory: {},
  });

  it('user-message-input normalizes a string', async () => {
    const result = await userMsg.execute(ctx('hello world'), {}, undefined);
    expect(result.output.message).toBe('hello world');
  });

  it('user-message-input normalizes a {message,metadata} payload', async () => {
    const result = await userMsg.execute(
      ctx({ message: 'hi', metadata: { source: 'widget' } }),
      {},
      undefined,
    );
    expect(result.output.message).toBe('hi');
    expect(result.output.metadata).toEqual({ source: 'widget' });
  });

  it('response-output passes through .text', async () => {
    const result = await respOut.execute(
      ctx({}),
      {},
      { text: 'final reply', citations: [] },
    );
    expect(result.output.text).toBe('final reply');
  });

  it('response-output renders a template', async () => {
    const result = await respOut.execute(
      ctx({}),
      { template: 'Answer: {{text}}' },
      { text: '42' },
    );
    expect(result.output.text).toBe('Answer: 42');
  });

  it('response-output drops missing template keys', async () => {
    const result = await respOut.execute(
      ctx({}),
      { template: 'Hi {{user.name}}' },
      {},
    );
    expect(result.output.text).toBe('Hi ');
  });
});
