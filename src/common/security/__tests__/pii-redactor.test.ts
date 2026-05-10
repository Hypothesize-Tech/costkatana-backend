import { redactPiiString, redactPiiDeep, hashRedact } from '../pii-redactor';

describe('redactPiiString', () => {
  it('redacts emails', () => {
    expect(redactPiiString('contact me at alice@example.com please')).toBe(
      'contact me at [REDACTED:email] please',
    );
  });

  it('redacts SSNs', () => {
    expect(redactPiiString('ssn 123-45-6789 attached')).toBe(
      'ssn [REDACTED:ssn] attached',
    );
  });

  it('redacts credit-card-shaped digit runs', () => {
    expect(redactPiiString('card 4111-1111-1111-1111 saved')).toBe(
      'card [REDACTED:card] saved',
    );
    // also handles space separator
    expect(redactPiiString('4111 1111 1111 1111')).toBe('[REDACTED:card]');
  });

  it('redacts phone numbers in common formats', () => {
    expect(redactPiiString('call (415) 555-1234 today')).toBe(
      'call [REDACTED:phone] today',
    );
    expect(redactPiiString('+1 415 555 1234 desk')).toBe(
      '[REDACTED:phone] desk',
    );
  });

  it('redacts SDK-style tokens (sk-, ghp_, AKIA, AIza)', () => {
    const tokens = [
      'sk-proj-abc1234567890XYZxyzABC',
      'ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ',
      'AKIAIOSFODNN7EXAMPLE',
      'AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI',
    ];
    for (const tok of tokens) {
      expect(redactPiiString(`auth: ${tok}`)).toContain('[REDACTED:token]');
    }
  });

  it('redacts Bearer / Basic credentials but preserves the scheme', () => {
    expect(
      redactPiiString('Authorization: Bearer eyJabc123def456ghi789jklMNOPQRSTUV'),
    ).toMatch(/Bearer \[REDACTED:credential\]/);
  });

  it('passes through innocuous text unchanged', () => {
    expect(redactPiiString('hello world, no pii here')).toBe(
      'hello world, no pii here',
    );
  });

  it('is idempotent', () => {
    const once = redactPiiString('a@b.com and 123-45-6789');
    const twice = redactPiiString(once);
    expect(twice).toBe(once);
  });
});

describe('redactPiiDeep', () => {
  it('walks nested objects + arrays and redacts string values', () => {
    const input = {
      user: { email: 'a@b.com', name: 'Alice' },
      tags: ['ssn:111-22-3333', 'plain'],
      counts: { total: 5, ssns: ['999-00-1111'] },
    };
    const out = redactPiiDeep(input);
    expect(out.user.email).toBe('[REDACTED:email]');
    expect(out.user.name).toBe('Alice');
    expect(out.tags[0]).toContain('[REDACTED:ssn]');
    expect(out.tags[1]).toBe('plain');
    expect(out.counts.total).toBe(5);
    expect(out.counts.ssns[0]).toBe('[REDACTED:ssn]');
  });

  it('preserves non-string scalars verbatim (numbers, bools, null)', () => {
    const input = { n: 42, b: true, x: null };
    expect(redactPiiDeep(input)).toEqual({ n: 42, b: true, x: null });
  });

  it('handles cycles without stack overflow', () => {
    const a: Record<string, unknown> = { name: 'a@b.com' };
    a['self'] = a; // cycle
    const out = redactPiiDeep(a);
    expect(out.name).toBe('[REDACTED:email]');
  });
});

describe('hashRedact', () => {
  it('produces a 12-char prefix from the chosen hash function', () => {
    const fakeHash = (s: string) => 'a'.repeat(64); // valid sha256 length
    expect(hashRedact('anything', fakeHash)).toBe('[HASH:aaaaaaaaaaaa]');
  });

  it('different inputs hash to different prefixes', () => {
    // Fake hash that surfaces the input in the leading bytes — that's all
    // hashRedact slices, so it lets us assert distinctness without
    // running real SHA-256.
    const fake = (s: string) =>
      s.repeat(64).slice(0, 64).padEnd(64, '0');
    const a = hashRedact('foo', fake);
    const b = hashRedact('bar', fake);
    expect(a).not.toBe(b);
    expect(a).toBe('[HASH:foofoofoofoo]');
    expect(b).toBe('[HASH:barbarbarbar]');
  });
});
