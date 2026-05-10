/**
 * Magic-byte file validator for upload paths.
 *
 * Why not the `file-type` npm package: that library is ESM-only at the
 * versions installed in this tree, and the backend is CommonJS. The set
 * of formats we actually accept (images, PDF, common Office docs) is
 * small enough that an in-house signature table is simpler than a
 * dynamic-import dance — and trivially testable.
 *
 * Behaviour: given a buffer + claimed mimeType, decide whether the
 * buffer's first bytes match a known signature for that mimeType. We
 * deliberately do NOT identify "the actual mime" of a buffer with no
 * claim — the caller always has a claim from the upload framing.
 *
 * Trade-off: returns `unknown` (and the caller should reject) for any
 * mimeType we don't have a signature for. This makes adding a new type
 * an explicit decision (add the signature here) rather than silently
 * trusting whatever the client claimed.
 */

export type ValidationOutcome =
  /** The buffer matches the claimed mimeType. */
  | { ok: true; mimeType: string }
  /** The buffer does NOT match the claimed mimeType — almost certainly malicious. */
  | { ok: false; reason: 'mismatch'; detected?: string; claimed: string }
  /** No signature on file for this mimeType — caller should refuse. */
  | { ok: false; reason: 'unsupported_mime'; claimed: string }
  /** Buffer too small to inspect. */
  | { ok: false; reason: 'too_small'; claimed: string };

interface Signature {
  /** Bytes that must appear at offset 0 (or at `offset` if provided). */
  bytes: number[];
  offset?: number;
  /** When set, run this extra predicate on the buffer to confirm. */
  extra?: (buf: Buffer) => boolean;
}

/**
 * Whitelist of mimeTypes we accept and the byte signatures that prove
 * a buffer claims that type. Multiple alternative signatures can be
 * listed for one mimeType (e.g. JPEG has two common SOI variants).
 */
const SIGNATURES: Record<string, Signature[]> = {
  'image/png': [{ bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  'image/jpeg': [
    { bytes: [0xff, 0xd8, 0xff, 0xe0] }, // JFIF
    { bytes: [0xff, 0xd8, 0xff, 0xe1] }, // EXIF
    { bytes: [0xff, 0xd8, 0xff, 0xdb] }, // raw JPEG quantization
    { bytes: [0xff, 0xd8, 0xff, 0xee] }, // JFIF (Adobe)
  ],
  'image/gif': [{ bytes: [0x47, 0x49, 0x46, 0x38] }],
  'image/webp': [
    {
      bytes: [0x52, 0x49, 0x46, 0x46], // "RIFF"
      // Confirm "WEBP" sits at offset 8 — RIFF can wrap other formats.
      extra: (buf) =>
        buf.length >= 12 && buf.slice(8, 12).toString('ascii') === 'WEBP',
    },
  ],
  'application/pdf': [{ bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }],
  // ZIP container — DOCX/XLSX/PPTX are all PK\x03\x04. We accept this for
  // upload but the caller is expected to scrutinize the inner manifest
  // before trusting the type fully.
  'application/zip': [{ bytes: [0x50, 0x4b, 0x03, 0x04] }],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    { bytes: [0x50, 0x4b, 0x03, 0x04] },
  ],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
    { bytes: [0x50, 0x4b, 0x03, 0x04] },
  ],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': [
    { bytes: [0x50, 0x4b, 0x03, 0x04] },
  ],
};

/**
 * Plain-text mime types where we can't enforce a binary signature. We
 * still verify the buffer is mostly printable ASCII / UTF-8 so a
 * `text/plain` claim on a binary blob (e.g. a renamed .exe) is rejected.
 */
const TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
]);

function looksTextual(buf: Buffer): boolean {
  if (buf.length === 0) return true;
  // Accept printable ASCII, common whitespace, and the start byte of
  // any multi-byte UTF-8 sequence. NUL or other control bytes outside
  // this set strongly suggest a binary blob.
  let printable = 0;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (
      (b >= 0x20 && b < 0x7f) ||
      b === 0x09 || // tab
      b === 0x0a || // \n
      b === 0x0d || // \r
      b >= 0x80 // UTF-8 multibyte continuation / start
    ) {
      printable += 1;
    }
  }
  return printable / buf.length > 0.95;
}

/**
 * Validate that `buf`'s magic bytes match `claimedMimeType`. Returns a
 * structured outcome — never throws.
 */
export function validateMagicBytes(
  buf: Buffer | Uint8Array | undefined,
  claimedMimeType: string,
): ValidationOutcome {
  if (!buf || buf.length === 0) {
    return { ok: false, reason: 'too_small', claimed: claimedMimeType };
  }
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);

  if (TEXT_MIME_TYPES.has(claimedMimeType)) {
    return looksTextual(b)
      ? { ok: true, mimeType: claimedMimeType }
      : {
          ok: false,
          reason: 'mismatch',
          claimed: claimedMimeType,
        };
  }

  const signatures = SIGNATURES[claimedMimeType];
  if (!signatures) {
    return { ok: false, reason: 'unsupported_mime', claimed: claimedMimeType };
  }

  for (const sig of signatures) {
    const offset = sig.offset ?? 0;
    if (b.length < offset + sig.bytes.length) continue;
    let matches = true;
    for (let i = 0; i < sig.bytes.length; i++) {
      if (b[offset + i] !== sig.bytes[i]) {
        matches = false;
        break;
      }
    }
    if (matches && (!sig.extra || sig.extra(b))) {
      return { ok: true, mimeType: claimedMimeType };
    }
  }

  return { ok: false, reason: 'mismatch', claimed: claimedMimeType };
}

/**
 * Convenience: the supported mimeTypes (whitelist).
 * Useful for upfront validation in DTOs / route guards.
 */
export const SUPPORTED_UPLOAD_MIME_TYPES: ReadonlySet<string> = new Set([
  ...Object.keys(SIGNATURES),
  ...TEXT_MIME_TYPES,
]);
