import { sessionReplayService } from '../services/sessionReplay.service';
import { Session } from '../models/Session';
import { Telemetry } from '../models/Telemetry';

// Mock the models
jest.mock('../models/Session');
jest.mock('../models/Telemetry');
jest.mock('../services/logging.service');

describe('SessionReplayService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('createOrMergeSession', () => {
        it('should create a manual session when no telemetry exists', async () => {
            const mockSession = {
                sessionId: 'test-session-id',
                userId: 'user-123',
                workspaceId: 'workspace-123',
                startedAt: new Date(),
                status: 'active',
                source: 'manual'
            };

            (Telemetry.findOne as jest.Mock).mockResolvedValue(null);
            (Session.create as jest.Mock).mockResolvedValue(mockSession);

            const result = await sessionReplayService.createOrMergeSession({
                userId: 'user-123',
                workspaceId: 'workspace-123',
                startedAt: new Date(),
                trackingEnabled: true,
                sessionReplayEnabled: true
            });

            expect(Telemetry.findOne).toHaveBeenCalled();
            expect(Session.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 'user-123',
                    workspaceId: 'workspace-123',
                    source: 'manual',
                    trackingEnabled: true,
                    sessionReplayEnabled: true
                })
            );
            expect(result).toEqual(mockSession);
        });

        it('should create a unified session when telemetry exists', async () => {
            const mockTelemetry = {
                trace_id: 'trace-123',
                user_id: 'user-123',
                workspace_id: 'workspace-123',
                timestamp: new Date()
            };

            const mockSession = {
                sessionId: 'test-session-id',
                userId: 'user-123',
                workspaceId: 'workspace-123',
                startedAt: new Date(),
                status: 'active',
                source: 'unified',
                telemetryTraceId: 'trace-123'
            };

            (Telemetry.findOne as jest.Mock).mockReturnValue({
                sort: jest.fn().mockReturnValue({
                    limit: jest.fn().mockResolvedValue(mockTelemetry)
                })
            });
            (Session.create as jest.Mock).mockResolvedValue(mockSession);
            (Telemetry.updateOne as jest.Mock).mockResolvedValue({});

            const result = await sessionReplayService.createOrMergeSession({
                userId: 'user-123',
                workspaceId: 'workspace-123',
                startedAt: new Date(),
                trackingEnabled: true,
                sessionReplayEnabled: true
            });

            expect(Session.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    source: 'unified',
                    telemetryTraceId: 'trace-123'
                })
            );
            expect(Telemetry.updateOne).toHaveBeenCalled();
            expect(result.source).toBe('unified');
        });
    });

    describe('getOrCreateActiveSession', () => {
        it('should return existing active session if found', async () => {
            const mockSession = {
                sessionId: 'existing-session-id',
                userId: 'user-123',
                status: 'active',
                updatedAt: new Date()
            };

            (Session.findOne as jest.Mock).mockReturnValue({
                sort: jest.fn().mockResolvedValue(mockSession)
            });
            (Session.updateOne as jest.Mock).mockResolvedValue({});

            const result = await sessionReplayService.getOrCreateActiveSession('user-123', {
                workspaceId: 'workspace-123'
            });

            expect(result).toBe('existing-session-id');
            expect(Session.updateOne).toHaveBeenCalled();
        });

        it('should create new session if no active session exists', async () => {
            const mockSession = {
                sessionId: 'new-session-id',
                userId: 'user-123',
                status: 'active'
            };

            (Session.findOne as jest.Mock).mockReturnValue({
                sort: jest.fn().mockResolvedValue(null)
            });
            (Telemetry.findOne as jest.Mock).mockReturnValue({
                sort: jest.fn().mockReturnValue({
                    limit: jest.fn().mockResolvedValue(null)
                })
            });
            (Session.create as jest.Mock).mockResolvedValue(mockSession);

            const result = await sessionReplayService.getOrCreateActiveSession('user-123', {
                workspaceId: 'workspace-123'
            });

            expect(result).toBe('new-session-id');
            expect(Session.create).toHaveBeenCalled();
        });
    });

    describe('addReplayData', () => {
        it('should add AI interaction to session', async () => {
            const mockUpdate = { acknowledged: true };
            (Session.updateOne as jest.Mock).mockResolvedValue(mockUpdate);

            await sessionReplayService.addReplayData({
                sessionId: 'test-session-id',
                aiInteraction: {
                    model: 'gpt-4',
                    prompt: 'test prompt',
                    response: 'test response',
                    tokens: { input: 10, output: 20 },
                    cost: 0.001
                }
            });

            expect(Session.updateOne).toHaveBeenCalledWith(
                { sessionId: 'test-session-id' },
                expect.objectContaining({
                    $set: expect.any(Object),
                    $push: expect.objectContaining({
                        'replayData.aiInteractions': expect.objectContaining({
                            model: 'gpt-4',
                            prompt: 'test prompt',
                            response: 'test response'
                        })
                    })
                })
            );
        });

        it('should add code context to session', async () => {
            const mockUpdate = { acknowledged: true };
            (Session.updateOne as jest.Mock).mockResolvedValue(mockUpdate);

            await sessionReplayService.addReplayData({
                sessionId: 'test-session-id',
                codeContext: {
                    filePath: 'src/test.ts',
                    content: 'const test = true;',
                    language: 'typescript'
                }
            });

            expect(Session.updateOne).toHaveBeenCalledWith(
                { sessionId: 'test-session-id' },
                expect.objectContaining({
                    $push: expect.objectContaining({
                        'replayData.codeContext': expect.objectContaining({
                            filePath: 'src/test.ts',
                            content: 'const test = true;',
                            language: 'typescript'
                        })
                    })
                })
            );
        });
    });

    describe('linkWithTelemetry', () => {
        it('should link session with telemetry bidirectionally', async () => {
            (Session.updateOne as jest.Mock).mockResolvedValue({ acknowledged: true });
            (Telemetry.updateOne as jest.Mock).mockResolvedValue({ acknowledged: true });

            await sessionReplayService.linkWithTelemetry('session-123', 'trace-123');

            expect(Session.updateOne).toHaveBeenCalledWith(
                { sessionId: 'session-123' },
                {
                    $set: {
                        source: 'unified',
                        telemetryTraceId: 'trace-123'
                    }
                }
            );

            expect(Telemetry.updateOne).toHaveBeenCalledWith(
                { trace_id: 'trace-123' },
                {
                    $set: {
                        'attributes.session_id': 'session-123',
                        'attributes.session_source': 'unified'
                    }
                }
            );
        });
    });

    describe('listSessionReplays', () => {
        it('should list sessions with pagination', async () => {
            const mockSessions = [
                { sessionId: 'session-1', userId: 'user-123' },
                { sessionId: 'session-2', userId: 'user-123' }
            ];

            (Session.find as jest.Mock).mockReturnValue({
                sort: jest.fn().mockReturnValue({
                    skip: jest.fn().mockReturnValue({
                        limit: jest.fn().mockReturnValue({
                            lean: jest.fn().mockResolvedValue(mockSessions)
                        })
                    })
                })
            });
            (Session.countDocuments as jest.Mock).mockResolvedValue(2);

            const result = await sessionReplayService.listSessionReplays({
                userId: 'user-123',
                page: 1,
                limit: 20
            });

            expect(result.sessions).toEqual(mockSessions);
            expect(result.total).toBe(2);
            expect(result.page).toBe(1);
            expect(result.totalPages).toBe(1);
        });

        it('should filter by source', async () => {
            const mockSessions = [
                { sessionId: 'session-1', source: 'unified' }
            ];

            (Session.find as jest.Mock).mockReturnValue({
                sort: jest.fn().mockReturnValue({
                    skip: jest.fn().mockReturnValue({
                        limit: jest.fn().mockReturnValue({
                            lean: jest.fn().mockResolvedValue(mockSessions)
                        })
                    })
                })
            });
            (Session.countDocuments as jest.Mock).mockResolvedValue(1);

            const result = await sessionReplayService.listSessionReplays({
                source: 'unified',
                page: 1,
                limit: 20
            });

            expect(Session.find).toHaveBeenCalledWith(
                expect.objectContaining({
                    source: 'unified'
                })
            );
            expect(result.sessions.length).toBe(1);
        });
    });

    describe('autoEndInactiveSessions', () => {
        it('should end inactive sessions', async () => {
            const mockResult = { modifiedCount: 3 };
            (Session.updateMany as jest.Mock).mockResolvedValue(mockResult);

            const count = await sessionReplayService.autoEndInactiveSessions();

            expect(count).toBe(3);
            expect(Session.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 'active'
                }),
                expect.objectContaining({
                    $set: {
                        status: 'completed',
                        endedAt: expect.any(Date)
                    }
                })
            );
        });
    });
});

