import {
  filterSensitiveSpanAttrs,
  isSensitiveAttrKey,
} from '../sensitive-attrs';

describe('isSensitiveAttrKey', () => {
  it('matches the documented sensitive fragments', () => {
    const sensitive = [
      'password',
      'user.password',
      'http.request.header.authorization',
      'cookie',
      'set-cookie',
      'api_key',
      'apikey',
      'API-KEY',
      'X-Token',
      'session_id',
      'client_secret',
      'private_key',
    ];
    for (const k of sensitive) expect(isSensitiveAttrKey(k)).toBe(true);
  });

  it('keeps innocuous keys', () => {
    const safe = [
      'http.method',
      'span.name',
      'user.id',
      'tenant.id',
      'http.status_code',
      'cost',
      'duration_ms',
    ];
    for (const k of safe) expect(isSensitiveAttrKey(k)).toBe(false);
  });

  it('keeps allowlist suffixes (_present, _hash)', () => {
    expect(isSensitiveAttrKey('costkatana.api_key_present')).toBe(false);
    expect(isSensitiveAttrKey('user.password_hash')).toBe(false);
  });

  it('handles empty / undefined input safely', () => {
    expect(isSensitiveAttrKey('')).toBe(false);
    // @ts-expect-error null path
    expect(isSensitiveAttrKey(null)).toBe(false);
  });
});

describe('filterSensitiveSpanAttrs', () => {
  it('drops sensitive keys and keeps the rest', () => {
    const out = filterSensitiveSpanAttrs({
      'http.method': 'GET',
      'http.request.header.authorization': 'Bearer xyz',
      'user.id': 'u1',
      api_key: 'sk-abc',
      'costkatana.api_key_present': true,
    });
    expect(out).toEqual({
      'http.method': 'GET',
      'user.id': 'u1',
      'costkatana.api_key_present': true,
    });
  });

  it('returns an empty object for undefined / non-object input', () => {
    expect(filterSensitiveSpanAttrs(undefined)).toEqual({});
    // @ts-expect-error string path
    expect(filterSensitiveSpanAttrs('not-an-object')).toEqual({});
  });
});
