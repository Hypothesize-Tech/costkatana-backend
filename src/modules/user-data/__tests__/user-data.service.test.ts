import { NotFoundException } from '@nestjs/common';
import { UserDataService } from '../user-data.service';

function makeService(over: {
  user?: any;
  conversations?: any[];
  messages?: any[];
  files?: any[];
  closure?: any;
} = {}): { svc: UserDataService; closureSpy: jest.Mock } {
  // Use `in` so an explicit `null` is preserved (otherwise `??` would
  // treat null as "use default").
  const resolvedUser = 'user' in over ? over.user : defaultUser();
  const userModel: any = {
    findById: jest.fn().mockReturnValue({
      lean: () => ({
        exec: jest.fn().mockResolvedValue(resolvedUser),
      }),
    }),
  };
  const mkFind = (rows: any[] = []) => ({
    sort: jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(rows),
        }),
      }),
    }),
  });
  const conversationModel: any = { find: jest.fn().mockReturnValue(mkFind(over.conversations ?? [])) };
  const chatMessageModel: any = { find: jest.fn().mockReturnValue(mkFind(over.messages ?? [])) };
  const uploadedFileModel: any = { find: jest.fn().mockReturnValue(mkFind(over.files ?? [])) };
  const closureSpy = jest.fn().mockResolvedValue({ message: 'queued' });
  const accountClosureService: any = {
    initiateAccountClosure: closureSpy,
  };
  // Use a real ObjectId-shaped string so the service's setImmediate
  // worker (which calls `new Types.ObjectId(jobId)`) doesn't bomb after
  // the test completes.
  const fakeJobId = '507f191e810c19729de860ea';
  const exportJobModel: any = {
    create: jest.fn().mockResolvedValue({ _id: fakeJobId }),
    findOne: jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      }),
    }),
    updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
  };
  return {
    svc: new UserDataService(
      userModel,
      conversationModel,
      chatMessageModel,
      uploadedFileModel,
      exportJobModel,
      accountClosureService,
    ),
    closureSpy,
    exportJobModel,
  };
}

function defaultUser(): any {
  return {
    _id: '507f1f77bcf86cd799439011',
    email: 'a@b.com',
    name: 'Alice',
    role: 'user',
    isActive: true,
    passwordHash: 'should-not-leak',
    mfaSecret: 'should-not-leak',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-06-01'),
  };
}

describe('UserDataService.exportUserData', () => {
  it('throws NotFoundException when the user does not exist', async () => {
    const { svc } = makeService({ user: null });
    await expect(svc.exportUserData('507f1f77bcf86cd799439011')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns a clean snapshot without secret material', async () => {
    const { svc } = makeService({
      conversations: [
        { _id: 'c1', title: 'Chat 1', createdAt: new Date(), messageCount: 4, totalCost: 0.02 },
      ],
      messages: [
        {
          _id: 'm1',
          conversationId: 'c1',
          role: 'assistant',
          content: 'hi',
          modelId: 'haiku',
          createdAt: new Date(),
        },
      ],
      files: [
        {
          _id: 'f1',
          fileName: 'doc.pdf',
          fileSize: 100,
          mimeType: 'application/pdf',
          uploadedAt: new Date(),
        },
      ],
    });
    const out = await svc.exportUserData('507f1f77bcf86cd799439011');
    expect(out.user.email).toBe('a@b.com');
    // Whitelisted output must not include the secret fields.
    expect(out.user).not.toHaveProperty('passwordHash');
    expect(out.user).not.toHaveProperty('mfaSecret');
    expect(out.conversations[0].title).toBe('Chat 1');
    expect(out.messages[0].role).toBe('assistant');
    expect(out.files[0].fileName).toBe('doc.pdf');
    expect(out.truncated).toEqual({
      conversations: false,
      messages: false,
      files: false,
    });
  });

  it('marks the slice as truncated when caps are hit', async () => {
    const { svc } = makeService({
      // limit() returns at most cap+1 rows; we simulate cap+1 to flip the flag.
      conversations: Array.from({ length: 1001 }, (_, i) => ({
        _id: `c${i}`,
        title: `t${i}`,
        createdAt: new Date(),
        messageCount: 0,
        totalCost: 0,
      })),
    });
    const out = await svc.exportUserData('507f1f77bcf86cd799439011');
    expect(out.truncated.conversations).toBe(true);
    expect(out.conversations).toHaveLength(1000);
  });
});

describe('UserDataService.startExportJob', () => {
  it('creates a pending job record and returns its id', async () => {
    const { svc, exportJobModel } = makeService();
    const result = await svc.startExportJob('507f1f77bcf86cd799439011');
    expect(exportJobModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' }),
    );
    expect(result.jobId).toBe('507f191e810c19729de860ea');
  });
});

describe('UserDataService.getExportJob', () => {
  it('returns null for a job id that does not belong to the caller', async () => {
    const { svc } = makeService();
    const out = await svc.getExportJob(
      '507f1f77bcf86cd799439011',
      '507f191e810c19729de860ea',
    );
    expect(out).toBeNull();
  });

  it('returns null for an invalid (non-ObjectId) job id', async () => {
    const { svc } = makeService();
    const out = await svc.getExportJob(
      '507f1f77bcf86cd799439011',
      'not-an-id',
    );
    expect(out).toBeNull();
  });
});

describe('UserDataService.requestDeletion', () => {
  it('delegates to AccountClosureService with password re-auth + reason', async () => {
    const { svc, closureSpy } = makeService();
    const result = await svc.requestDeletion(
      'u1',
      'pw-confirm',
      'no longer needed',
    );
    expect(closureSpy).toHaveBeenCalledWith(
      'u1',
      'pw-confirm',
      'no longer needed',
    );
    expect(result.gracePeriodDays).toBe(30);
    expect(result.message).toBe('queued');
  });
});
