import { AgentTemplateService } from '../agent-template.service';
import { recordGenAIUsage } from '../../../../utils/genaiTelemetry';

jest.mock('../../../../utils/genaiTelemetry', () => ({
  recordGenAIUsage: jest.fn(),
}));

const recordMock = recordGenAIUsage as unknown as jest.Mock;

describe('AgentTemplateService telemetry wiring', () => {
  beforeEach(() => recordMock.mockReset());

  it('emits a 0-token agent.template.instantiate event after a successful clone', async () => {
    const fakeTemplate = {
      _id: 'tmpl_id',
      slug: 'starter-faq',
      name: 'Starter FAQ',
      description: 'Built-in template',
      isOfficial: true,
      dag: { nodes: [], edges: [] },
    };
    const findOne = jest.fn().mockResolvedValue(fakeTemplate);
    const updateOne = jest.fn().mockResolvedValue({ acknowledged: true });
    const templateModel = { findOne, updateOne } as unknown as any;

    const fakeAgentResult = {
      agent: { _id: 'agent_id', toObject: () => ({}) },
      version: { _id: 'version_id', toObject: () => ({}) },
    };
    const definitionService = {
      create: jest.fn().mockResolvedValue(fakeAgentResult),
    } as unknown as any;

    const service = new AgentTemplateService(templateModel, definitionService);
    await service.cloneToAgent('user_abc', 'starter-faq', 'My Clone', 'proj_xyz', 'team_t');

    expect(definitionService.create).toHaveBeenCalledTimes(1);
    expect(updateOne).toHaveBeenCalledWith(
      { _id: 'tmpl_id' },
      { $inc: { clonedCount: 1 } },
    );
    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'internal',
        operationName: 'agent.template.instantiate',
        promptTokens: 0,
        completionTokens: 0,
        cost: 0,
        userId: 'user_abc',
        metadata: expect.objectContaining({
          templateSlug: 'starter-faq',
          templateId: 'tmpl_id',
          agentId: 'agent_id',
          versionId: 'version_id',
          projectId: 'proj_xyz',
          teamId: 'team_t',
        }),
        extra: expect.objectContaining({
          eventCategory: 'template',
          source: 'agent-template',
          isOfficial: true,
        }),
      }),
    );
  });

  it('does not record a usage event when the template is not found', async () => {
    const findOne = jest.fn().mockResolvedValue(null);
    const templateModel = {
      findOne,
      updateOne: jest.fn(),
    } as unknown as any;
    const definitionService = { create: jest.fn() } as unknown as any;

    const service = new AgentTemplateService(templateModel, definitionService);
    await expect(
      service.cloneToAgent('user_abc', 'missing-slug'),
    ).rejects.toThrow();
    expect(recordMock).not.toHaveBeenCalled();
    expect(definitionService.create).not.toHaveBeenCalled();
  });
});
