import {
  assertPublicHttpsUrlSync,
  UrlSecurityError,
} from '../url-validator';

describe('UrlValidator (sync, IP-literal mode)', () => {
  describe('rejects', () => {
    it.each([
      'http://example.com',
      'ftp://example.com',
      'javascript:alert(1)',
      'file:///etc/passwd',
    ])('non-https scheme %s', (url) => {
      expect(() => assertPublicHttpsUrlSync(url)).toThrow(UrlSecurityError);
    });

    it.each([
      'https://169.254.169.254/latest/meta-data/iam/security-credentials/',
      'https://127.0.0.1/admin',
      'https://10.0.0.5/internal',
      'https://172.16.5.5/private',
      'https://192.168.1.1/router',
      'https://0.0.0.0/',
      'https://[::1]/loopback',
      'https://[fe80::1]/link-local',
      'https://[fc00::1]/ula',
    ])('private/loopback/link-local IP %s', (url) => {
      expect(() => assertPublicHttpsUrlSync(url)).toThrow(UrlSecurityError);
    });

    it.each([
      'https://localhost/',
      'https://metadata.google.internal/computeMetadata/',
    ])('blocked hostname %s', (url) => {
      expect(() => assertPublicHttpsUrlSync(url)).toThrow(UrlSecurityError);
    });

    it('malformed URL', () => {
      expect(() => assertPublicHttpsUrlSync('not a url')).toThrow(
        UrlSecurityError,
      );
    });
  });

  describe('allows', () => {
    it.each([
      'https://anthropic.com/pricing',
      'https://www.openai.com/api/pricing',
      'https://example.com/path?q=1',
      'https://8.8.8.8/dns', // Google DNS, public IPv4
    ])('public hostname / public IP %s', (url) => {
      expect(() => assertPublicHttpsUrlSync(url)).not.toThrow();
    });
  });

  describe('http allowed when requireHttps=false', () => {
    it('lets through plain http', () => {
      expect(() =>
        assertPublicHttpsUrlSync('http://example.com', { requireHttps: false }),
      ).not.toThrow();
    });
    it('still blocks private IPv4', () => {
      expect(() =>
        assertPublicHttpsUrlSync('http://10.0.0.5/', {
          requireHttps: false,
        }),
      ).toThrow(UrlSecurityError);
    });
  });
});
