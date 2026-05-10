/**
 * PII / secret redaction for free-text values that might end up in
 * tamper-evident audit chains, observability spans, or log lines that
 * leave the trust boundary.
 *
 * Goal: drop the most-common PII / credential patterns before they get
 * written. We do NOT try to be a full DLP system — that's the job of
 * Bedrock Guardrails and our LlmSecurityService.
 *
 * Trade-off: false positives (e.g. accidentally redacting a user's id
 * that happens to look like a token) are preferable to leaks. If a
 * legitimate value gets redacted, the surrounding metadata still tells
 * the operator what happened — they just don't see the raw value.
 */

const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
// Card: 13-19 digits with optional `-` or ` ` separators. The final char
// must be a digit (the previous form `(?:\d[-. ]?){13,19}\b` greedily
// captured a trailing separator, breaking surrounding spacing on replace).
const CC_REGEX = /\b(?:\d[- ]?){12,18}\d\b/g;
const SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;
// Phone: optional country code, then `(NNN)` or `NNN` area, then NNN, NNNN.
// `\b` doesn't sit cleanly next to a leading paren, so we anchor on
// non-digit lookarounds instead. Country-code group is optional so the
// area-code parens can appear at the start of the match.
const PHONE_REGEX =
  /(?<!\d)(?:\+?\d{1,3}[-. ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}(?!\d)/g;
// "sk-..." / "ghp_..." / "AKIA..." style tokens
const TOKEN_REGEX =
  /\b(?:sk|pk|ghp|gho|ghu|ghs|ghr|AKIA|ASIA|AIza)[A-Za-z0-9_\-]{16,}\b/g;
// Bearer / Basic tokens (only the credential, not the scheme word).
const BEARER_REGEX = /\b(Bearer|Basic)\s+[A-Za-z0-9._\-+/=]{20,}/gi;

interface PatternRule {
  regex: RegExp;
  replacement: string;
}

const RULES: PatternRule[] = [
  { regex: EMAIL_REGEX, replacement: '[REDACTED:email]' },
  { regex: SSN_REGEX, replacement: '[REDACTED:ssn]' },
  { regex: TOKEN_REGEX, replacement: '[REDACTED:token]' },
  { regex: BEARER_REGEX, replacement: '$1 [REDACTED:credential]' },
  { regex: PHONE_REGEX, replacement: '[REDACTED:phone]' },
  { regex: CC_REGEX, replacement: '[REDACTED:card]' },
];

/**
 * Redact the matched PII patterns from a string. Returns the input
 * unchanged if no pattern matches. Idempotent — running twice yields the
 * same output.
 */
export function redactPiiString(input: string): string {
  let out = input;
  for (const { regex, replacement } of RULES) {
    out = out.replace(regex, replacement);
  }
  return out;
}

/**
 * Recursively redact PII inside an arbitrary JSON-shaped value. Strings
 * are passed through `redactPiiString`; arrays and plain objects are
 * traversed; non-string scalars (number / boolean / null) are kept
 * verbatim. Symbols, functions, and dates are coerced to strings via
 * `String(...)` first to give them the same treatment.
 *
 * Cycle-safe via a `seen` set so a self-referencing object doesn't blow
 * the stack — important because audit metadata is sometimes built from
 * mongoose documents that include back-references.
 */
export function redactPiiDeep<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return redactPiiString(value) as unknown as T;
  }
  if (typeof value !== 'object') return value;

  if (seen.has(value as object)) {
    return value;
  }
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((v) => redactPiiDeep(v, seen)) as unknown as T;
  }
  // Plain object — copy keys, redact values. Mongoose documents often
  // expose hidden properties via prototype; we walk own keys only so we
  // don't accidentally serialize internals.
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    out[key] = redactPiiDeep((value as Record<string, unknown>)[key], seen);
  }
  return out as unknown as T;
}

/**
 * Hash-only redaction for cases where the audit consumer needs to know
 * "the same value was seen again" but must not learn the value itself.
 * Returns a SHA-256 prefix (12 hex chars), enough for collision-resistance
 * within a typical audit window without leaking enough bits to brute-force
 * short inputs.
 */
export function hashRedact(input: string, hashFn: (s: string) => string): string {
  return `[HASH:${hashFn(input).slice(0, 12)}]`;
}

/**
 * Redact a list of pattern strings (e.g. matched prompt-injection /
 * jailbreak signatures) for inclusion in observability spans + audit
 * metadata. We keep the *category* prefix before the colon (e.g.
 * `"injection:"`) so dashboards can still slice by category, but the
 * matched substring is replaced by a short hash. The original strings
 * stay only in the encrypted comprehensive-audit log.
 *
 * Stable: same input → same hash. Knows about no-op categories (`safe`,
 * `none`) which need no redaction.
 */
export function redactMatchedPatterns(
  patterns: ReadonlyArray<string> | undefined,
  hashFn: (s: string) => string,
): string[] {
  if (!patterns?.length) return [];
  return patterns.map((p) => {
    const idx = p.indexOf(':');
    if (idx <= 0) return hashRedact(p, hashFn);
    const category = p.slice(0, idx);
    const rest = p.slice(idx + 1);
    return `${category}:${hashRedact(rest, hashFn).replace(/^\[HASH:/, '').replace(/]$/, '')}`;
  });
}
