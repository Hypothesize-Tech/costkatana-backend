/**
 * Single-use refresh-token rotation behaviour.
 *
 * We don't construct a full AuthService here (it has many heavy
 * dependencies); instead we exercise the rotation logic by stubbing the
 * Redis client + the session-revoker + the user model and driving
 * `refreshTokens()` directly. The point is to confirm that the SECOND
 * presentation of a refresh token is rejected and triggers session
 * revocation, regardless of any other auth path.
 */
import { UnauthorizedException } from '@nestjs/common';

// jest module mocks must come before requiring the SUT.
jest.mock('../../../services/redis.service', () => {
  const store = new Map<string, string>();
  return {
    redisService: {
      exists: jest.fn((key: string) => Promise.resolve(store.has(key))),
      set: jest.fn((key: string, value: any) => {
        store.set(key, String(value));
        return Promise.resolve();
      }),
      __reset: () => store.clear(),
    },
  };
});

const mockRevokeUserSession = jest.fn().mockResolvedValue(undefined);
const mockUserFindById = jest.fn();
const mockSessionFindOne = jest.fn().mockResolvedValue({
  _id: 's1',
  expiresAt: new Date(Date.now() + 60_000),
});
const mockJwtVerify = jest.fn();
const mockJwtSign = jest.fn().mockReturnValue('signed-jwt');

jest.mock('../auth.service', () => {
  const original = jest.requireActual('../auth.service');
  return original;
});

import { redisService } from '../../../services/redis.service';

describe('refresh-token rotation', () => {
  beforeEach(() => {
    (redisService as any).__reset();
    mockRevokeUserSession.mockClear();
    mockJwtVerify.mockReset();
    mockJwtSign.mockClear();
  });

  function makeService(): any {
    // Build a minimal AuthService-shaped object that exercises the
    // refreshTokens replay logic. We import the real class then patch
    // its dependencies via assignment — easier than threading a full
    // NestJS test bed for a single method's worth of behaviour.
    const { AuthService } = require('../auth.service');
    const svc = Object.create(AuthService.prototype);
    svc.logger = { warn: jest.fn(), log: jest.fn(), debug: jest.fn() };
    svc.verifyRefreshToken = (token: string) => mockJwtVerify(token);
    svc.userModel = { findById: mockUserFindById };
    svc.userSessionModel = { findOne: mockSessionFindOne };
    svc.jwtService = { sign: mockJwtSign };
    svc.configService = { get: (_k: string, d: string) => d };
    svc.userSessionService = { revokeUserSession: mockRevokeUserSession };
    return svc;
  }

  it('rejects the second presentation of the same refresh token', async () => {
    const svc = makeService();
    const payload = {
      id: 'u1',
      email: 'a@b.com',
      role: 'user',
      jti: 'sess-1',
      sessionId: 'sess-1',
      rjti: 'r-abcdef',
    };
    mockJwtVerify.mockReturnValue(payload);
    mockUserFindById.mockResolvedValue({
      _id: 'u1',
      email: 'a@b.com',
      role: 'user',
      accountClosure: { status: 'active' },
    });

    // First call succeeds.
    await expect(svc.refreshTokens('tkn-1')).resolves.toBeDefined();

    // Second call with the same payload (same rjti) must reject.
    await expect(svc.refreshTokens('tkn-1')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    expect(mockRevokeUserSession).toHaveBeenCalledTimes(1);
    expect(mockRevokeUserSession).toHaveBeenCalledWith('u1', 'sess-1');
  });

  it('does not require rjti for legacy refresh tokens', async () => {
    const svc = makeService();
    mockJwtVerify.mockReturnValue({
      id: 'u1',
      email: 'a@b.com',
      role: 'user',
      jti: 'sess-1',
      sessionId: 'sess-1',
      // No rjti — token issued before this change.
    });
    mockUserFindById.mockResolvedValue({
      _id: 'u1',
      email: 'a@b.com',
      role: 'user',
      accountClosure: { status: 'active' },
    });

    await expect(svc.refreshTokens('legacy-tkn')).resolves.toBeDefined();
    expect(mockRevokeUserSession).not.toHaveBeenCalled();
  });
});
