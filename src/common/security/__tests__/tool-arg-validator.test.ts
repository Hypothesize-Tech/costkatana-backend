import { z } from 'zod';
import {
  registerToolSchema,
  validateToolArgs,
  formatValidationErrorForToolResult,
  clearToolSchemas,
} from '../tool-arg-validator';

describe('ToolArgValidator', () => {
  beforeEach(() => clearToolSchemas());

  it('returns ok=true and original args for tools without a schema (with one warning)', () => {
    const result = validateToolArgs('legacy_tool', { foo: 'bar' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args).toEqual({ foo: 'bar' });
    }
  });

  it('validates registered schema and rejects unknown fields when strict', () => {
    registerToolSchema(
      'my_tool',
      z.object({ query: z.string() }).strict(),
    );
    const ok = validateToolArgs('my_tool', { query: 'hi' });
    expect(ok.ok).toBe(true);
    const bad = validateToolArgs('my_tool', { query: 'hi', extra: 'no' });
    expect(bad.ok).toBe(false);
  });

  it('rejects wrong types', () => {
    registerToolSchema(
      'my_tool',
      z.object({ count: z.number().int() }).strict(),
    );
    const bad = validateToolArgs('my_tool', { count: 'not a number' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error).toBe('invalid_args');
      expect(bad.issues?.[0].path).toContain('count');
    }
  });

  it('parses stringified JSON arg blobs (Bedrock pattern)', () => {
    registerToolSchema(
      'my_tool',
      z.object({ query: z.string() }).strict(),
    );
    const ok = validateToolArgs('my_tool', '{"query":"hi"}');
    expect(ok.ok).toBe(true);
  });

  it('rejects malformed string args', () => {
    registerToolSchema('my_tool', z.object({ query: z.string() }).strict());
    const bad = validateToolArgs('my_tool', 'not json');
    expect(bad.ok).toBe(false);
  });

  it('formats error for tool_result feedback', () => {
    registerToolSchema(
      'my_tool',
      z.object({ query: z.string().min(3) }).strict(),
    );
    const bad = validateToolArgs('my_tool', { query: 'a' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      const formatted = formatValidationErrorForToolResult(bad);
      expect(formatted).toContain('tool_result_error=invalid_args');
      expect(formatted).toContain('Re-issue the tool call');
    }
  });
});
