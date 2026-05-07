/**
 * Shared shape-tests for all OAuth refreshers.
 *
 * Each refresher must:
 *   1. Throw `requiresReconnection` when there's no refresh token on file.
 *   2. Throw `requiresReconnection` when the provider returns an error
 *      that means "the refresh token is dead" (per-provider error codes).
 *   3. Return a well-formed RefreshedTokens object on success, including
 *      `expiresAt` derived from `expires_in`.
 *
 * One test table covers all four refreshers — much smaller than three
 * separate test files, and any new refresher gets the same coverage by
 * adding one row.
 */
import { GithubRefresher } from '../github.refresher';
import { GoogleRefresher } from '../google.refresher';
import { SlackRefresher } from '../slack.refresher';
import { JiraRefresher } from '../jira.refresher';
import { DiscordRefresher } from '../discord.refresher';
import { LinearRefresher } from '../linear.refresher';
import type {
  OAuthConnection,
  OAuthRefresher,
} from '../../oauth-token-manager';

interface RefresherCase {
  name: string;
  factory: () => OAuthRefresher;
  successPayload: object;
  reconnectPayload: object; // body that should trigger requiresReconnection
  errorPayloadOk?: boolean; // some providers return ok:false in body, others 4xx
  setEnv: () => void;
}

const cases: RefresherCase[] = [
  {
    name: 'GithubRefresher',
    factory: () => new GithubRefresher(),
    successPayload: {
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_in: 3600,
      scope: 'repo read:user',
    },
    reconnectPayload: { error: 'bad_refresh_token' },
    errorPayloadOk: true, // GitHub returns HTTP 200 with error in body
    setEnv: () => {
      process.env.GITHUB_CLIENT_ID = 'cid';
      process.env.GITHUB_CLIENT_SECRET = 'csec';
    },
  },
  {
    name: 'GoogleRefresher',
    factory: () => new GoogleRefresher(),
    successPayload: {
      access_token: 'new-access',
      refresh_token: 'rotated-refresh',
      expires_in: 3600,
      scope: 'https://www.googleapis.com/auth/drive',
    },
    reconnectPayload: {
      error: 'invalid_grant',
      error_description: 'Token has been expired or revoked.',
    },
    errorPayloadOk: true,
    setEnv: () => {
      process.env.GOOGLE_CLIENT_ID = 'cid';
      process.env.GOOGLE_CLIENT_SECRET = 'csec';
    },
  },
  {
    name: 'SlackRefresher',
    factory: () => new SlackRefresher(),
    successPayload: {
      ok: true,
      access_token: 'new-access',
      refresh_token: 'rotated-refresh',
      expires_in: 3600,
      scope: 'chat:write,users:read',
    },
    reconnectPayload: { ok: false, error: 'invalid_refresh_token' },
    errorPayloadOk: true,
    setEnv: () => {
      process.env.SLACK_CLIENT_ID = 'cid';
      process.env.SLACK_CLIENT_SECRET = 'csec';
    },
  },
  {
    name: 'JiraRefresher',
    factory: () => new JiraRefresher(),
    successPayload: {
      access_token: 'new-access',
      refresh_token: 'rotated-refresh',
      expires_in: 3600,
      scope: 'read:jira-work read:jira-user',
    },
    reconnectPayload: { error: 'invalid_grant' },
    errorPayloadOk: false, // Atlassian returns 4xx on error
    setEnv: () => {
      process.env.JIRA_CLIENT_ID = 'cid';
      process.env.JIRA_CLIENT_SECRET = 'csec';
    },
  },
  {
    name: 'DiscordRefresher',
    factory: () => new DiscordRefresher(),
    successPayload: {
      access_token: 'new-access',
      refresh_token: 'rotated-refresh',
      expires_in: 604_800,
      scope: 'identify guilds',
    },
    reconnectPayload: { error: 'invalid_grant' },
    errorPayloadOk: false,
    setEnv: () => {
      process.env.DISCORD_CLIENT_ID = 'cid';
      process.env.DISCORD_CLIENT_SECRET = 'csec';
    },
  },
  {
    name: 'LinearRefresher',
    factory: () => new LinearRefresher(),
    successPayload: {
      access_token: 'new-access',
      refresh_token: 'rotated-refresh',
      expires_in: 315_360_000,
      scope: 'read,write',
    },
    reconnectPayload: { error: 'invalid_grant' },
    errorPayloadOk: false,
    setEnv: () => {
      process.env.LINEAR_CLIENT_ID = 'cid';
      process.env.LINEAR_CLIENT_SECRET = 'csec';
    },
  },
];

function makeConnection(over: Partial<OAuthConnection> = {}): OAuthConnection {
  return {
    provider: 'placeholder',
    connectionId: 'c1',
    accessToken: 'old',
    refreshToken: 'old-refresh',
    grantedScopes: [],
    ...over,
  };
}

const ORIGINAL_ENV = { ...process.env };
afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe.each(cases)('$name', (c) => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    // Strip provider envs so each test sets exactly what it needs.
    for (const k of Object.keys(process.env)) {
      if (
        k.startsWith('GITHUB_') ||
        k.startsWith('GOOGLE_') ||
        k.startsWith('SLACK_') ||
        k.startsWith('JIRA_') ||
        k.startsWith('DISCORD_') ||
        k.startsWith('LINEAR_')
      ) {
        delete process.env[k];
      }
    }
    c.setEnv();
    (global as any).fetch = undefined;
  });

  it('throws requiresReconnection when no refresh token is on file', async () => {
    const r = c.factory();
    await expect(
      r.refresh(makeConnection({ refreshToken: undefined })),
    ).rejects.toMatchObject({ requiresReconnection: true });
  });

  it('returns a valid RefreshedTokens shape on a successful refresh', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(c.successPayload),
    });
    const out = await c.factory().refresh(makeConnection());
    expect(out.accessToken).toBe('new-access');
    expect(out.expiresAt).toBeInstanceOf(Date);
    expect(out.grantedScopes?.length).toBeGreaterThan(0);
  });

  it("flags requiresReconnection on the provider's revoked-token error code", async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: c.errorPayloadOk ?? true,
      status: c.errorPayloadOk ? 200 : 400,
      json: () => Promise.resolve(c.reconnectPayload),
    });
    await expect(c.factory().refresh(makeConnection())).rejects.toMatchObject({
      requiresReconnection: true,
    });
  });
});
