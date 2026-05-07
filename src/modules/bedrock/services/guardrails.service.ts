/**
 * Bedrock Guardrails wrapper.
 *
 * Calls `ApplyGuardrail` to inspect inputs and outputs against the configured
 * guardrail (denied topics, content filters, PII redaction, custom word
 * filters). Returns either the original content (when GUARDRAIL_INTERVENED is
 * absent) or the redacted/blocked variant.
 *
 * Two modes:
 * - **Disabled** when `BEDROCK_GUARDRAIL_ID` is unset — returns input as-is.
 * - **Enforced** when `BEDROCK_GUARDRAIL_ID` is set — substitutes redacted
 *   text from the guardrail response. On block, throws `GuardrailBlockedError`.
 *
 * Log-only mode is intentionally not exposed as a toggle: it would let PII
 * leak through under operator error.
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  BedrockRuntimeClient,
  ApplyGuardrailCommand,
  type ApplyGuardrailCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';

export type GuardrailSource = 'INPUT' | 'OUTPUT';

export class GuardrailBlockedError extends Error {
  constructor(
    message: string,
    public readonly action:
      | 'GUARDRAIL_INTERVENED'
      | 'NONE'
      | 'BLOCKED'
      | 'ANONYMIZED',
    public readonly source: GuardrailSource,
  ) {
    super(message);
    this.name = 'GuardrailBlockedError';
  }
}

export interface GuardrailResult {
  content: string;
  intervened: boolean;
  blocked: boolean;
  action: ApplyGuardrailCommandOutput['action'];
  outputs?: ApplyGuardrailCommandOutput['outputs'];
}

@Injectable()
export class GuardrailsService {
  private readonly logger = new Logger(GuardrailsService.name);
  private readonly client: BedrockRuntimeClient;

  constructor() {
    this.client = new BedrockRuntimeClient({
      region: process.env.AWS_BEDROCK_REGION || 'us-east-1',
    });
  }

  private get guardrailId(): string | undefined {
    return process.env.BEDROCK_GUARDRAIL_ID?.trim() || undefined;
  }

  private get guardrailVersion(): string {
    return 'DRAFT';
  }

  isEnabled(): boolean {
    return !!this.guardrailId;
  }

  /**
   * Apply the configured guardrail to a piece of content. Returns the
   * possibly-redacted content; throws `GuardrailBlockedError` when the
   * guardrail blocks AND we are not in log-only mode.
   */
  async apply(content: string, source: GuardrailSource): Promise<GuardrailResult> {
    const id = this.guardrailId;
    if (!id) {
      return { content, intervened: false, blocked: false, action: 'NONE' };
    }
    if (!content || content.length === 0) {
      return { content, intervened: false, blocked: false, action: 'NONE' };
    }

    let response: ApplyGuardrailCommandOutput;
    try {
      response = await this.client.send(
        new ApplyGuardrailCommand({
          guardrailIdentifier: id,
          guardrailVersion: this.guardrailVersion,
          source,
          content: [{ text: { text: content } }],
        }),
      );
    } catch (err) {
      // Network or permission failure on the guardrail itself shouldn't break
      // the user's request — log and pass through. (Failing closed on this is
      // tempting but would make every Bedrock outage take chat down too.)
      this.logger.warn('Bedrock Guardrails apply failed', {
        source,
        error: err instanceof Error ? err.message : String(err),
      });
      return { content, intervened: false, blocked: false, action: 'NONE' };
    }

    const action = response.action ?? 'NONE';
    const intervened = action !== 'NONE';
    const blocked = action === 'GUARDRAIL_INTERVENED';
    const redacted =
      response.outputs?.map((o) => o.text).filter(Boolean).join('\n') ||
      content;

    if (intervened) {
      this.logger.log('Bedrock Guardrail intervened', {
        source,
        action,
        assessmentsCount: response.assessments?.length ?? 0,
      });
    }

    if (blocked) {
      throw new GuardrailBlockedError(
        `Guardrail blocked ${source.toLowerCase()} content`,
        action,
        source,
      );
    }

    return {
      content: redacted,
      intervened,
      blocked,
      action,
      outputs: response.outputs,
    };
  }
}

/**
 * Functional wrapper: takes a guardrails-enabled function `f(text, source)` and
 * applies the guardrail before delegating. Used by callers that don't want to
 * inject the service directly (e.g. inside a free function).
 */
export async function withGuardrail<T>(
  guardrails: GuardrailsService,
  args: { text: string; source: GuardrailSource },
  fn: (text: string) => Promise<T>,
): Promise<T> {
  const checked = await guardrails.apply(args.text, args.source);
  return fn(checked.content);
}
