import { ContextBuildStage } from '../stages/context-build.stage';
import type { StageContext } from '../types/stage-context';

function ctx(conversation: any): StageContext {
  return {
    requestId: 'r',
    startTime: Date.now(),
    userId: 'u',
    dto: { modelId: 'm' } as any,
    conversation,
    errors: [],
    rollbacks: [],
  };
}

describe('ContextBuildStage', () => {
  const stage = new ContextBuildStage();

  it('extracts github / vercel / mongodb contexts from conversation', async () => {
    const conv: any = {
      githubContext: {
        connectionId: { toString: () => 'gc' },
        repositoryId: 'r1',
        repositoryName: 'r',
        repositoryFullName: 'org/r',
        integrationId: { toString: () => 'gi' },
        branchName: 'main',
      },
      vercelContext: {
        connectionId: { toString: () => 'vc' },
        projectId: 'p1',
        projectName: 'p',
      },
      mongodbContext: {
        connectionId: { toString: () => 'mc' },
        activeDatabase: 'db',
        activeCollection: 'col',
      },
    };
    const res = await stage.run(ctx(conv));
    expect(res.success).toBe(true);
    if (res.success && res.mutates) {
      expect(res.mutates.githubContext?.connectionId).toBe('gc');
      expect(res.mutates.githubContext?.branchName).toBe('main');
      expect(res.mutates.vercelContext?.projectId).toBe('p1');
      expect(res.mutates.mongodbContext?.activeDatabase).toBe('db');
    }
  });

  it('returns no-op when no integration contexts on conversation', async () => {
    const res = await stage.run(ctx({}));
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.mutates?.githubContext).toBeUndefined();
      expect(res.mutates?.vercelContext).toBeUndefined();
      expect(res.mutates?.mongodbContext).toBeUndefined();
    }
  });

  it('returns ok() when ConversationStage did not run', async () => {
    const c: StageContext = {
      requestId: 'r',
      startTime: Date.now(),
      userId: 'u',
      dto: { modelId: 'm' } as any,
      errors: [],
      rollbacks: [],
    };
    const res = await stage.run(c);
    expect(res.success).toBe(true);
  });
});
