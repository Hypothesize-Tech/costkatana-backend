import { TextToAgentService } from '../text-to-agent.service';
import { AgentCompilerService } from '../agent-compiler.service';
import { BedrockService } from '../../../bedrock/bedrock.service';

jest.mock('../../../bedrock/bedrock.service', () => ({
  BedrockService: {
    invokeConverseText: jest.fn(),
  },
}));

const invokeMock = BedrockService.invokeConverseText as unknown as jest.Mock;

describe('TextToAgentService telemetry wiring', () => {
  const compiler = new AgentCompilerService();
  let service: TextToAgentService;

  beforeEach(() => {
    invokeMock.mockReset();
    service = new TextToAgentService(compiler);
  });

  it('forwards builder telemetry context to invokeConverseText on success', async () => {
    invokeMock.mockResolvedValue({
      response: JSON.stringify({
        name: 'My Agent',
        dag: {
          nodes: [
            {
              id: 'n1',
              type: 'user-message-input',
              position: { x: 0, y: 0 },
              data: { label: 'in', config: {} },
            },
            {
              id: 'n2',
              type: 'response-output',
              position: { x: 100, y: 0 },
              data: { label: 'out', config: {} },
            },
          ],
          edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
        },
      }),
      inputTokens: 10,
      outputTokens: 20,
    });

    const result = await service.generate('Build me an FAQ bot', {
      userId: 'user_abc',
      projectId: 'proj_xyz',
      traceId: 'trace_123',
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [, , opts] = invokeMock.mock.calls[0];
    expect(opts.telemetry).toMatchObject({
      operationName: 'agent.builder.text_to_agent',
      eventCategory: 'builder',
      source: 'agent-builder',
      userId: 'user_abc',
      requestId: 'trace_123',
      metadata: {
        projectId: 'proj_xyz',
        descriptionLength: 'Build me an FAQ bot'.length,
      },
    });
    expect(typeof opts.telemetry.sessionId).toBe('string');
    expect(opts.telemetry.sessionId.length).toBeGreaterThan(0);

    expect(result.builderSessionId).toBe(opts.telemetry.sessionId);
    expect(result.suggestedName).toBe('My Agent');
  });

  it('reuses caller-provided builderSessionId so iterative builds group together', async () => {
    invokeMock.mockResolvedValue({
      response: '{}',
      inputTokens: 1,
      outputTokens: 1,
    });

    const result = await service.generate('hello world', {
      userId: 'u',
      builderSessionId: 'fixed-session-id',
    });

    const [, , opts] = invokeMock.mock.calls[0];
    expect(opts.telemetry.sessionId).toBe('fixed-session-id');
    expect(result.builderSessionId).toBe('fixed-session-id');
  });

  it('still returns a fallback DAG (and a builderSessionId) when the LLM call throws', async () => {
    invokeMock.mockRejectedValue(new Error('bedrock down'));

    const result = await service.generate('build something');
    expect(result.dag.nodes.length).toBeGreaterThan(0);
    expect(typeof result.builderSessionId).toBe('string');
    expect(result.builderSessionId.length).toBeGreaterThan(0);
  });
});
