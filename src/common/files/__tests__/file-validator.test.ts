import {
  validateMagicBytes,
  SUPPORTED_UPLOAD_MIME_TYPES,
} from '../file-validator';

const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const JPEG_JFIF = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PDF_HEADER = Buffer.from('%PDF-1.4\n%abcd', 'binary');
const WEBP_HEADER = Buffer.concat([
  Buffer.from([0x52, 0x49, 0x46, 0x46]), // RIFF
  Buffer.from([0x00, 0x00, 0x00, 0x00]), // size
  Buffer.from('WEBP', 'ascii'),
  Buffer.alloc(4),
]);
const ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

describe('validateMagicBytes', () => {
  it('accepts a real PNG header for image/png', () => {
    const r = validateMagicBytes(PNG_HEADER, 'image/png');
    expect(r.ok).toBe(true);
  });

  it('accepts JPEG JFIF header for image/jpeg', () => {
    const r = validateMagicBytes(JPEG_JFIF, 'image/jpeg');
    expect(r.ok).toBe(true);
  });

  it('accepts a PDF header for application/pdf', () => {
    const r = validateMagicBytes(PDF_HEADER, 'application/pdf');
    expect(r.ok).toBe(true);
  });

  it('accepts a real WEBP container (RIFF...WEBP)', () => {
    const r = validateMagicBytes(WEBP_HEADER, 'image/webp');
    expect(r.ok).toBe(true);
  });

  it('rejects a RIFF that is not WEBP', () => {
    const wav = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.alloc(4),
      Buffer.from('WAVE', 'ascii'),
    ]);
    const r = validateMagicBytes(wav, 'image/webp');
    expect(r.ok).toBe(false);
  });

  it('flags a PDF body claimed as image/png as mismatch (the renamed-PDF case)', () => {
    const r = validateMagicBytes(PDF_HEADER, 'image/png');
    expect(r).toEqual({
      ok: false,
      reason: 'mismatch',
      claimed: 'image/png',
    });
  });

  it("rejects an unsupported claimed mime so adding a new type is explicit", () => {
    const r = validateMagicBytes(PNG_HEADER, 'application/x-msdownload');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('unsupported_mime');
    }
  });

  it('returns too_small for empty input', () => {
    const r = validateMagicBytes(Buffer.alloc(0), 'image/png');
    expect(r).toEqual({ ok: false, reason: 'too_small', claimed: 'image/png' });
  });

  it('accepts ASCII text for text/plain and rejects binary blobs', () => {
    const txt = Buffer.from('hello, world\n', 'utf8');
    expect(validateMagicBytes(txt, 'text/plain').ok).toBe(true);
    // Binary blob with a NUL byte at start
    const blob = Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff, 0x00]);
    expect(validateMagicBytes(blob, 'text/plain').ok).toBe(false);
  });

  it('accepts a ZIP container for OOXML mimeTypes (docx/xlsx/pptx)', () => {
    for (const mt of [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ]) {
      expect(validateMagicBytes(ZIP_HEADER, mt).ok).toBe(true);
    }
  });

  it('exposes the supported mime list', () => {
    expect(SUPPORTED_UPLOAD_MIME_TYPES.has('image/png')).toBe(true);
    expect(SUPPORTED_UPLOAD_MIME_TYPES.has('text/plain')).toBe(true);
    expect(SUPPORTED_UPLOAD_MIME_TYPES.has('application/octet-stream')).toBe(
      false,
    );
  });
});
