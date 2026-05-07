/**
 * Filter for OpenTelemetry span attributes that should never leave the
 * trust boundary. Used by `SelfHealingSpanProcessor` immediately before
 * serialization to Redis / export to the OTel collector.
 *
 * Strategy: drop matching keys entirely. Replacing the value with
 * `[REDACTED]` would still emit the key — useful for some debugging,
 * but a leaked schema is itself a recon signal. Dropping is the more
 * conservative default; downstream code that needs to know "a key was
 * dropped" can read `droppedAttributesCount` (already part of the
 * ReadableSpan contract).
 */

/**
 * Case-insensitive substring matchers. A key is dropped if any of these
 * substrings appears in it. Tighter than a single big regex because
 * each matcher is documented independently.
 */
const SENSITIVE_KEY_FRAGMENTS = [
  'password',
  'passwd',
  'secret',
  'apikey',
  'api_key',
  'api-key',
  'token',
  'authorization',
  'auth_header',
  'cookie',
  'set-cookie',
  'session_id',
  'sessionid',
  'private_key',
  'privatekey',
  'client_secret',
];

/**
 * Test whether a span attribute key looks sensitive. Case-insensitive.
 *
 * Allowlist exception: keys ending in `_present` or `_hash` indicate the
 * caller already redacted (e.g. `costkatana.api_key_present: true`) — keep.
 */
export function isSensitiveAttrKey(key: string): boolean {
  if (!key) return false;
  if (key.endsWith('_present') || key.endsWith('_hash')) return false;
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_FRAGMENTS.some((frag) => lower.includes(frag));
}

/**
 * Return a copy of `attrs` with every sensitive-looking key removed.
 * Treats `undefined` / non-object input as empty.
 */
export function filterSensitiveSpanAttrs<
  T extends Record<string, unknown> | undefined,
>(attrs: T): Record<string, unknown> {
  if (!attrs || typeof attrs !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (isSensitiveAttrKey(key)) continue;
    out[key] = value;
  }
  return out;
}
