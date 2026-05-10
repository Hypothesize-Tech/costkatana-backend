import { Types } from 'mongoose';
import { PromptVersionService } from '../services/prompt-version.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

describe('PromptVersionService', () => {
  const ownerId = new Types.ObjectId().toHexString();
  const otherUserId = new Types.ObjectId().toHexString();
  const templateId = new Types.ObjectId().toHexString();

  function makeTemplate(overrides: Record<string, unknown> = {}) {
    const doc: Record<string, unknown> = {
      _id: new Types.ObjectId(templateId),
      createdBy: { toString: () => ownerId },
      content: 'old',
      version: 1,
      currentVersionId: undefined,
      save: jest.fn().mockImplementation(async function (this: any) {
        return this;
      }),
      canAccess: jest.fn().mockReturnValue(true),
      ...overrides,
    };
    return doc;
  }

  function makeService(opts: {
    template?: ReturnType<typeof makeTemplate> | null;
    lastVersion?: { _id: Types.ObjectId; version: number } | null;
  }) {
    const template = opts.template ?? makeTemplate();
    const versionDocs: Array<Record<string, unknown>> = [];

    const versionModel = {
      findOne: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest
            .fn()
            .mockResolvedValue(opts.lastVersion ?? null),
        }),
      }),
      create: jest.fn().mockImplementation(async (doc: Record<string, unknown>) => {
        const created = { _id: new Types.ObjectId(), ...doc };
        versionDocs.push(created);
        return created;
      }),
    };

    const templateModel = {
      findById: jest.fn().mockResolvedValue(template),
    };

    return {
      service: new PromptVersionService(
        versionModel as any,
        templateModel as any,
      ),
      versionModel,
      templateModel,
      template,
      versionDocs,
    };
  }

  it('creates the first version with version=1 when none exist', async () => {
    const harness = makeService({ lastVersion: null });

    const created = await harness.service.createVersion(ownerId, {
      templateId,
      content: 'hello world',
      changeNote: 'initial',
    });

    expect(harness.versionModel.create).toHaveBeenCalledTimes(1);
    expect((created as any).version).toBe(1);
    expect((created as any).content).toBe('hello world');
    // Side effects on the template
    expect(harness.template.save).toHaveBeenCalled();
    expect((harness.template as any).version).toBe(1);
    expect((harness.template as any).content).toBe('hello world');
  });

  it('increments version when previous versions exist', async () => {
    const harness = makeService({
      lastVersion: { _id: new Types.ObjectId(), version: 7 },
    });

    const created = await harness.service.createVersion(ownerId, {
      templateId,
      content: 'updated',
    });

    expect((created as any).version).toBe(8);
  });

  it('rejects createVersion when caller does not own the template', async () => {
    const template = makeTemplate({
      createdBy: { toString: () => ownerId },
    });
    const harness = makeService({ template });
    await expect(
      harness.service.createVersion(otherUserId, {
        templateId,
        content: 'x',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws NotFound when template does not exist', async () => {
    const harness = makeService({ template: null as any });
    harness.templateModel.findById = jest.fn().mockResolvedValue(null);
    await expect(
      harness.service.createVersion(ownerId, {
        templateId,
        content: 'x',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
