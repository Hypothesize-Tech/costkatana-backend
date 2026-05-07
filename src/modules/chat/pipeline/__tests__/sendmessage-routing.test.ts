/**
 * Verifies the new public `sendMessage` entry point delegates through
 * `ChatPipeline.execute()` and ultimately reaches the legacy
 * `processChatRequest` body via the `ExecutionAdapter`.
 *
 * We don't construct the full `ChatService` here (its constructor takes 30+
 * dependencies). Instead we exercise the SAME mechanics — pipeline +
 * SecurityStage + ExecutionStage with an adapter — that ChatService.onModuleInit
 * wires up.
 */
import { ChatPipeline } from '../chat-pipeline.service';
import { SecurityStage } from '../stages/security.stage';
import { ExecutionStage } from '../stages/execution.stage';
import type { StageContext } from '../types/stage-context';

describe('sendMessage flow (pipeline + adapter)', () => {
  it('runs SecurityStage then ExecutionStage then sets ctx.response', async () => {
    const calls: string[] = [];
    const securityHandler: any = {
      checkMessageSecurity: jest.fn(async () => {
        calls.push('security');
        return { isBlocked: false };
      }),
    };
    const security = new SecurityStage(securityHandler);
    const execution = new ExecutionStage();

    // Adapter mirrors what ChatService.onModuleInit registers in production.
    const fakeResponse = {
      id: 'm1',
      conversationId: 'c1',
      role: 'assistant' as const,
      content: 'hi back',
      modelId: 'm',
      timestamp: new Date(),
    };
    execution.setAdapter({
      runRoute: async (_route, _ctx) => {
        calls.push('execute');
        return { response: fakeResponse };
      },
    });

    const pipeline = new ChatPipeline();
    const ctx: StageContext = {
      requestId: 'r1',
      startTime: Date.now(),
      userId: 'u1',
      dto: { modelId: 'm', message: 'hi' } as any,
      errors: [],
      rollbacks: [],
    };

    await pipeline.execute([security, execution], ctx);

    expect(calls).toEqual(['security', 'execute']);
    expect(ctx.response).toBe(fakeResponse);
  });

  it('aborts the pipeline when SecurityStage rejects, never calling executor', async () => {
    const securityHandler: any = {
      checkMessageSecurity: jest.fn(async () => ({
        isBlocked: false,
      })),
    };
    const security = new SecurityStage(securityHandler);
    const execution = new ExecutionStage();
    let executorCalled = false;
    execution.setAdapter({
      runRoute: async () => {
        executorCalled = true;
        return { response: {} };
      },
    });

    // Empty message + no template + no attachments → SecurityStage fails.
    const pipeline = new ChatPipeline();
    const ctx: StageContext = {
      requestId: 'r1',
      startTime: Date.now(),
      userId: 'u1',
      dto: { modelId: 'm', message: '' } as any,
      errors: [],
      rollbacks: [],
    };

    await expect(pipeline.execute([security, execution], ctx)).rejects.toThrow(
      /empty_input|At least one of message/,
    );
    expect(executorCalled).toBe(false);
  });
});
