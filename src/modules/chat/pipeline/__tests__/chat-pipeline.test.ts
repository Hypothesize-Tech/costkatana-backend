import { ChatPipeline, PipelineFailure } from '../chat-pipeline.service';
import type { PipelineStage, StageResult } from '../types/stage-result';
import { ok, fail, shortCircuit } from '../types/stage-result';
import type { StageContext } from '../types/stage-context';

function makeCtx(overrides: Partial<StageContext> = {}): StageContext {
  return {
    requestId: 'req-1',
    startTime: Date.now(),
    userId: 'u1',
    dto: { modelId: 'm', message: 'hi' } as any,
    errors: [],
    rollbacks: [],
    ...overrides,
  };
}

function stage(
  name: string,
  fn: (ctx: StageContext) => Promise<StageResult> | StageResult,
): PipelineStage {
  return { name, run: async (c) => fn(c) };
}

describe('ChatPipeline', () => {
  it('runs stages in order and merges mutations', async () => {
    const pipeline = new ChatPipeline();
    const observed: string[] = [];

    const stages = [
      stage('A', () => {
        observed.push('A');
        return ok({ effectiveMessage: 'enriched' });
      }),
      stage('B', (ctx) => {
        observed.push('B');
        expect(ctx.effectiveMessage).toBe('enriched');
        return ok({ route: 'web_scraper' });
      }),
      stage('C', (ctx) => {
        observed.push('C');
        expect(ctx.route).toBe('web_scraper');
        return ok();
      }),
    ];

    const out = await pipeline.execute(stages, makeCtx());
    expect(observed).toEqual(['A', 'B', 'C']);
    expect(out.effectiveMessage).toBe('enriched');
    expect(out.route).toBe('web_scraper');
  });

  it('short-circuits the rest of the pipeline when a stage flags it', async () => {
    const pipeline = new ChatPipeline();
    const observed: string[] = [];

    const stages = [
      stage('A', () => {
        observed.push('A');
        return ok({ effectiveMessage: 'first' });
      }),
      stage('SHORT', () => {
        observed.push('SHORT');
        return shortCircuit({ route: 'mcp' });
      }),
      stage('AFTER', () => {
        observed.push('AFTER');
        return ok();
      }),
    ];

    const out = await pipeline.execute(stages, makeCtx());
    expect(observed).toEqual(['A', 'SHORT']);
    expect(out.route).toBe('mcp');
  });

  it('runs rollbacks in reverse order on failure', async () => {
    const pipeline = new ChatPipeline();
    const events: string[] = [];

    const stages = [
      stage('A', () =>
        ok({}, async () => {
          events.push('rollback-A');
        }),
      ),
      stage('B', () =>
        ok({}, async () => {
          events.push('rollback-B');
        }),
      ),
      stage('C', () => fail('C', 'boom', 'something broke')),
    ];

    await expect(pipeline.execute(stages, makeCtx())).rejects.toBeInstanceOf(
      PipelineFailure,
    );
    // Compensators run in reverse: B then A.
    expect(events).toEqual(['rollback-B', 'rollback-A']);
  });

  it('treats a thrown stage error as a failure and rolls back', async () => {
    const pipeline = new ChatPipeline();
    const events: string[] = [];

    const stages = [
      stage('A', () =>
        ok({}, async () => {
          events.push('rollback-A');
        }),
      ),
      stage('B', () => {
        throw new Error('unexpected');
      }),
    ];

    let caught: PipelineFailure | undefined;
    try {
      await pipeline.execute(stages, makeCtx());
    } catch (e) {
      caught = e as PipelineFailure;
    }
    expect(caught).toBeInstanceOf(PipelineFailure);
    expect(caught?.stageError.code).toBe('unhandled_throw');
    expect(events).toEqual(['rollback-A']);
  });

  it('continues rolling back even if a compensator itself throws', async () => {
    const pipeline = new ChatPipeline();
    const events: string[] = [];
    const stages = [
      stage('A', () =>
        ok({}, async () => {
          events.push('rollback-A');
        }),
      ),
      stage('B', () =>
        ok({}, async () => {
          events.push('rollback-B-failing');
          throw new Error('rollback failed');
        }),
      ),
      stage('C', () => fail('C', 'boom', 'broke')),
    ];

    await expect(pipeline.execute(stages, makeCtx())).rejects.toBeInstanceOf(
      PipelineFailure,
    );
    // B's broken rollback should NOT prevent A's rollback from running.
    expect(events).toEqual(['rollback-B-failing', 'rollback-A']);
  });

  it('does not include errors / rollbacks in mutates merge', async () => {
    const pipeline = new ChatPipeline();
    const stages = [
      stage('A', () =>
        ok({
          // Stage tries to overwrite bookkeeping — orchestrator must ignore.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...({ errors: [{ stage: 'fake', code: 'x', message: 'no' }], rollbacks: [] } as any),
          effectiveMessage: 'ok',
        }),
      ),
    ];
    const out = await pipeline.execute(stages, makeCtx());
    expect(out.errors).toHaveLength(0);
    expect(out.rollbacks).toHaveLength(0);
    expect(out.effectiveMessage).toBe('ok');
  });
});
