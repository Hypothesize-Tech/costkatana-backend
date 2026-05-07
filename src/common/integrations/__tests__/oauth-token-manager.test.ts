import {
  OAuthConnection,
  OAuthRefresher,
  OAuthScopeError,
  OAuthTokenManager,
  OAuthTokenRefreshError,
  RefreshedTokens,
} from '../oauth-token-manager';

function makeConnection(over: Partial<OAuthConnection> = {}): OAuthConnection {
  return {
    provider: 'github',
    connectionId: 'c1',
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h from now
    grantedScopes: ['repo', 'read:user'],
    ...over,
  };
}

class StubRefresher implements OAuthRefresher {
  readonly provider = 'github';
  constructor(private readonly impl: () => Promise<RefreshedTokens>) {}
  refresh(): Promise<RefreshedTokens> {
    return this.impl();
  }
}

describe('OAuthTokenManager.ensureFresh', () => {
  let persisted: Array<{ conn: OAuthConnection; tokens: RefreshedTokens }>;
  let mgr: OAuthTokenManager;

  beforeEach(() => {
    persisted = [];
    mgr = new OAuthTokenManager(async (conn, tokens) => {
      persisted.push({ conn, tokens });
    });
  });

  it('returns the same connection when not near expiry', async () => {
    const conn = makeConnection({
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
    const out = await mgr.ensureFresh(conn);
    expect(out.accessToken).toBe('old-access');
    expect(persisted).toHaveLength(0);
  });

  it("refreshes when token is within the skew window", async () => {
    mgr.registerRefresher(
      new StubRefresher(async () => ({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        grantedScopes: ['repo', 'read:user'],
      })),
    );
    const conn = makeConnection({
      expiresAt: new Date(Date.now() + 30 * 1000), // 30s from now (< 60s skew)
    });
    const out = await mgr.ensureFresh(conn);
    expect(out.accessToken).toBe('new-access');
    expect(out.refreshToken).toBe('new-refresh');
    expect(persisted).toHaveLength(1);
  });

  it('throws OAuthTokenRefreshError when no refresher is registered', async () => {
    const conn = makeConnection({ expiresAt: new Date(Date.now() - 1) });
    await expect(mgr.ensureFresh(conn)).rejects.toBeInstanceOf(
      OAuthTokenRefreshError,
    );
  });

  it('propagates requiresReconnection from a refresher error', async () => {
    mgr.registerRefresher(
      new StubRefresher(async () => {
        const e = new Error('bad_refresh_token');
        (e as { requiresReconnection?: boolean }).requiresReconnection = true;
        throw e;
      }),
    );
    const conn = makeConnection({ expiresAt: new Date(Date.now() - 1) });
    await expect(mgr.ensureFresh(conn)).rejects.toMatchObject({
      requiresReconnection: true,
    });
  });

  it("rejects calls missing required scopes BEFORE attempting refresh", async () => {
    const conn = makeConnection({ grantedScopes: ['read:user'] });
    let refreshed = false;
    mgr.registerRefresher(
      new StubRefresher(async () => {
        refreshed = true;
        return { accessToken: 'should-not-happen' };
      }),
    );
    await expect(
      mgr.ensureFresh(conn, ['repo', 'read:user']),
    ).rejects.toBeInstanceOf(OAuthScopeError);
    expect(refreshed).toBe(false);
  });

  it("rechecks scopes after refresh in case the provider narrowed them", async () => {
    mgr.registerRefresher(
      new StubRefresher(async () => ({
        accessToken: 'new-access',
        grantedScopes: ['read:user'], // narrower than what was granted before
      })),
    );
    const conn = makeConnection({
      expiresAt: new Date(Date.now() - 1),
      grantedScopes: ['repo', 'read:user'],
    });
    await expect(
      mgr.ensureFresh(conn, ['repo']),
    ).rejects.toBeInstanceOf(OAuthScopeError);
  });

  it('handles non-expiring connections (no expiresAt) without refreshing', async () => {
    const conn = makeConnection({ expiresAt: undefined });
    const out = await mgr.ensureFresh(conn);
    expect(out).toBe(conn);
  });
});
