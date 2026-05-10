import {
  EncryptionEnvelope,
  EncryptionEnvelopeService,
} from '../encryption-envelope.service';

const fakeConfig = (key?: string) => ({ get: (_: string) => ({ key }) }) as any;

describe('EncryptionEnvelopeService', () => {
  const ORIGINAL_ENV = { ...process.env };
  beforeEach(() => {
    // Clear any encryption key envs that bled in from .env so tests
    // are deterministic across runs.
    process.env = { ...ORIGINAL_ENV };
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('ENCRYPTION_KEY')) delete process.env[k];
    }
  });
  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('encrypts and decrypts with a single configured key (legacy compat)', () => {
    process.env.ENCRYPTION_KEY = 'legacy-secret-key';
    const svc = new EncryptionEnvelopeService(fakeConfig('legacy-secret-key'));
    const env = svc.encrypt('hello-world');
    expect(env.v).toBe(1);
    expect(svc.decrypt(env)).toBe('hello-world');
  });

  it('uses the highest configured key version by default', () => {
    process.env.ENCRYPTION_KEY_V1 = 'k1';
    process.env.ENCRYPTION_KEY_V2 = 'k2';
    process.env.ENCRYPTION_KEY_V3 = 'k3';
    const svc = new EncryptionEnvelopeService(fakeConfig());
    expect(svc.encrypt('x').v).toBe(3);
  });

  it("respects ENCRYPTION_KEY_VERSION when pinned", () => {
    process.env.ENCRYPTION_KEY_V1 = 'k1';
    process.env.ENCRYPTION_KEY_V2 = 'k2';
    process.env.ENCRYPTION_KEY_VERSION = '1';
    const svc = new EncryptionEnvelopeService(fakeConfig());
    expect(svc.encrypt('x').v).toBe(1);
  });

  it('rejects ENCRYPTION_KEY_VERSION pointing at a missing key', () => {
    process.env.ENCRYPTION_KEY_V1 = 'k1';
    process.env.ENCRYPTION_KEY_VERSION = '7';
    expect(() => new EncryptionEnvelopeService(fakeConfig())).toThrow(
      /no key material for v7/,
    );
  });

  it('decrypts older envelopes after a key rotation', () => {
    // 1) Boot with V1 only, encrypt some data.
    process.env.ENCRYPTION_KEY_V1 = 'old-key';
    const svcOld = new EncryptionEnvelopeService(fakeConfig());
    const oldEnv = svcOld.encrypt('legacy-secret');

    // 2) Add V2 as the current.
    process.env.ENCRYPTION_KEY_V2 = 'new-key';
    const svcNew = new EncryptionEnvelopeService(fakeConfig());
    expect(svcNew.encrypt('fresh').v).toBe(2);
    // The old envelope still decodes.
    expect(svcNew.decrypt(oldEnv)).toBe('legacy-secret');
  });

  it('re-encrypts a stale envelope onto the current key version', () => {
    process.env.ENCRYPTION_KEY_V1 = 'k1';
    const svcV1 = new EncryptionEnvelopeService(fakeConfig());
    const oldEnv = svcV1.encrypt('rotate-me');

    process.env.ENCRYPTION_KEY_V2 = 'k2';
    const svcV2 = new EncryptionEnvelopeService(fakeConfig());

    expect(svcV2.needsReencryption(oldEnv)).toBe(true);
    const fresh = svcV2.reencrypt(oldEnv);
    expect(fresh.v).toBe(2);
    expect(svcV2.decrypt(fresh)).toBe('rotate-me');
  });

  it('throws on decrypt when the envelope key version is no longer loaded', () => {
    process.env.ENCRYPTION_KEY_V1 = 'k1';
    const svc = new EncryptionEnvelopeService(fakeConfig());
    const tampered: EncryptionEnvelope = { ...svc.encrypt('x'), v: 99 };
    expect(() => svc.decrypt(tampered)).toThrow(/key v99 not loaded/);
  });

  it('produces unique IVs across calls (no nonce reuse)', () => {
    process.env.ENCRYPTION_KEY_V1 = 'k1';
    const svc = new EncryptionEnvelopeService(fakeConfig());
    const ivs = new Set<string>();
    for (let i = 0; i < 10; i++) ivs.add(svc.encrypt('same-text').iv);
    expect(ivs.size).toBe(10);
  });

  it('throws clearly when no keys are configured at all', () => {
    expect(() => new EncryptionEnvelopeService(fakeConfig())).toThrow(
      /No encryption keys configured/,
    );
  });
});
