/**
 * URL validation against SSRF.
 *
 * Resolves DNS and rejects requests targeting private/internal address space
 * — including AWS instance metadata (169.254.169.254), GCP metadata,
 * loopback, link-local, RFC1918, IPv6 ULA, and link-local v6.
 *
 * Use `assertPublicHttpsUrl(url)` before any outbound `axios.get()` whose
 * URL originates from user input or model output.
 */
import { promises as dns, type LookupAddress } from 'node:dns';
import { URL } from 'node:url';

export class UrlSecurityError extends Error {
  constructor(message: string, public readonly url: string) {
    super(message);
    this.name = 'UrlSecurityError';
  }
}

/**
 * IPv4 CIDRs that must never receive outbound traffic from this service.
 * Documented blocks (RFC1918, link-local, loopback, broadcast, etc.).
 */
const BLOCKED_IPV4_CIDRS: Array<[string, number]> = [
  ['0.0.0.0', 8], // Current network
  ['10.0.0.0', 8], // RFC1918
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // Loopback
  ['169.254.0.0', 16], // Link-local + AWS/GCP/Azure metadata
  ['172.16.0.0', 12], // RFC1918
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.168.0.0', 16], // RFC1918
  ['198.18.0.0', 15], // Benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // Multicast
  ['240.0.0.0', 4], // Reserved / broadcast
  ['255.255.255.255', 32], // Broadcast
];

/**
 * Hostnames that resolve to cloud metadata services. We block by name
 * in addition to IP because some providers expose them via DNS-only labels
 * that may not appear in the resolved A record set in all environments.
 */
const BLOCKED_HOSTNAMES = new Set<string>([
  'metadata.google.internal',
  'metadata',
  'localhost',
  'localhost.localdomain',
]);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return null;
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function ipv4InCidr(ip: string, cidr: [string, number]): boolean {
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(cidr[0]);
  if (ipInt === null || baseInt === null) return false;
  if (cidr[1] === 0) return true;
  const mask = (~0 << (32 - cidr[1])) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

function isBlockedIpv4(ip: string): boolean {
  return BLOCKED_IPV4_CIDRS.some((cidr) => ipv4InCidr(ip, cidr));
}

function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase().trim();
  if (lower === '::' || lower === '::1') return true;
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — extract and check the v4 portion
  const v4Mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Mapped) return isBlockedIpv4(v4Mapped[1]);
  // ULA fc00::/7 — first byte 0xfc or 0xfd
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
  // Link-local fe80::/10
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;
  // Multicast ff00::/8
  if (lower.startsWith('ff')) return true;
  return false;
}

function looksLikeIpv4(host: string): boolean {
  return /^\d+\.\d+\.\d+\.\d+$/.test(host);
}

function looksLikeIpv6(host: string): boolean {
  // Bracketed (`[::1]`) or bare colon-separated.
  return host.includes(':') && !looksLikeIpv4(host);
}

export interface AssertOptions {
  /**
   * If true, only `https:` is permitted. Defaults to true.
   * Set false only for test fixtures that explicitly need plain HTTP.
   */
  requireHttps?: boolean;
}

/**
 * Throws `UrlSecurityError` if `rawUrl` resolves to or names a private,
 * loopback, link-local, or otherwise non-public host — or fails to parse.
 *
 * Resolves both A and AAAA records and rejects if ANY answer is blocked.
 */
export async function assertPublicHttpsUrl(
  rawUrl: string,
  opts: AssertOptions = {},
): Promise<void> {
  const requireHttps = opts.requireHttps !== false;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UrlSecurityError('Malformed URL', rawUrl);
  }

  if (requireHttps && parsed.protocol !== 'https:') {
    throw new UrlSecurityError(
      `Non-https scheme not permitted (${parsed.protocol})`,
      rawUrl,
    );
  }
  if (!requireHttps && !['http:', 'https:'].includes(parsed.protocol)) {
    throw new UrlSecurityError(
      `Unsupported scheme (${parsed.protocol})`,
      rawUrl,
    );
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname) {
    throw new UrlSecurityError('Empty hostname', rawUrl);
  }

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new UrlSecurityError(
      `Hostname is in the blocklist (${hostname})`,
      rawUrl,
    );
  }

  // Hostname literal is an IP — check directly without DNS lookup.
  if (looksLikeIpv4(hostname)) {
    if (isBlockedIpv4(hostname)) {
      throw new UrlSecurityError(
        `IPv4 in private/blocked range (${hostname})`,
        rawUrl,
      );
    }
    return;
  }
  if (looksLikeIpv6(hostname)) {
    if (isBlockedIpv6(hostname)) {
      throw new UrlSecurityError(
        `IPv6 in private/blocked range (${hostname})`,
        rawUrl,
      );
    }
    return;
  }

  // DNS-resolve and check every answer.
  let resolved: LookupAddress[];
  try {
    resolved = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (err) {
    throw new UrlSecurityError(
      `DNS resolution failed for ${hostname}: ${
        err instanceof Error ? err.message : String(err)
      }`,
      rawUrl,
    );
  }

  for (const addr of resolved) {
    if (addr.family === 4 && isBlockedIpv4(addr.address)) {
      throw new UrlSecurityError(
        `Resolved to private IPv4 (${addr.address})`,
        rawUrl,
      );
    }
    if (addr.family === 6 && isBlockedIpv6(addr.address)) {
      throw new UrlSecurityError(
        `Resolved to private IPv6 (${addr.address})`,
        rawUrl,
      );
    }
  }
}

/**
 * Synchronous variant — only checks scheme + literal-IP hostnames.
 * Use this when you already have an IP literal or when DNS lookup is too
 * expensive; pair with `assertPublicHttpsUrl` for full safety on hostnames.
 */
export function assertPublicHttpsUrlSync(
  rawUrl: string,
  opts: AssertOptions = {},
): void {
  const requireHttps = opts.requireHttps !== false;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UrlSecurityError('Malformed URL', rawUrl);
  }
  if (requireHttps && parsed.protocol !== 'https:') {
    throw new UrlSecurityError(
      `Non-https scheme not permitted (${parsed.protocol})`,
      rawUrl,
    );
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new UrlSecurityError(
      `Hostname is in the blocklist (${hostname})`,
      rawUrl,
    );
  }
  if (looksLikeIpv4(hostname) && isBlockedIpv4(hostname)) {
    throw new UrlSecurityError(
      `IPv4 in private/blocked range (${hostname})`,
      rawUrl,
    );
  }
  if (looksLikeIpv6(hostname) && isBlockedIpv6(hostname)) {
    throw new UrlSecurityError(
      `IPv6 in private/blocked range (${hostname})`,
      rawUrl,
    );
  }
}
