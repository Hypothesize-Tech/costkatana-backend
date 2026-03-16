import { Injectable, Logger } from '@nestjs/common';

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const REDACT_PLACEHOLDER = '[REDACTED]';

@Injectable()
export class IntegrationPrivacyService {
  private readonly logger = new Logger(IntegrationPrivacyService.name);

  /**
   * Redact PII from a string (emails, optional patterns).
   */
  redactString(value: string): string {
    if (typeof value !== 'string') return value;
    return value.replace(EMAIL_REGEX, REDACT_PLACEHOLDER);
  }

  /**
   * Recursively redact PII in an object. Keys matching known PII names are redacted entirely.
   */
  redactPayload<T>(
    payload: T,
    piiKeys: string[] = [
      'password',
      'token',
      'accessToken',
      'secret',
      'apiKey',
      'authorization',
    ],
  ): T {
    if (payload == null) return payload;
    if (typeof payload === 'string') return this.redactString(payload) as T;
    if (Array.isArray(payload))
      return payload.map((item) => this.redactPayload(item, piiKeys)) as T;
    if (typeof payload === 'object') {
      const out: Record<string, unknown> = {};
      const keySet = new Set(piiKeys.map((k) => k.toLowerCase()));
      for (const [k, v] of Object.entries(payload)) {
        if (keySet.has(k.toLowerCase())) {
          out[k] = REDACT_PLACEHOLDER;
        } else {
          out[k] = this.redactPayload(v, piiKeys);
        }
      }
      return out as T;
    }
    return payload;
  }

  /**
   * Return whether a payload appears to contain PII (for logging decisions).
   */
  containsPII(value: string): boolean {
    return EMAIL_REGEX.test(value);
  }
}
