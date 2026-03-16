/**
 * TOON (Token Optimized Object Notation) utilities
 * Used for encoding/decoding structured data into compact token formats
 */

export interface TOONEncoded {
  format: string;
  version: string;
  data: any;
  compressed: boolean;
}

export interface TOONDecoded {
  original: any;
  metadata: {
    compressionRatio: number;
    originalTokens: number;
    compressedTokens: number;
    format: string;
  };
}

/**
 * Encode data into TOON format
 */
export function encodeToTOON(
  data: any,
  options: { compress?: boolean } = {},
): TOONEncoded {
  const { compress = true } = options;

  // Create compact representation
  const encoded: TOONEncoded = {
    format: 'TOON',
    version: '1.0',
    data: compress ? compressData(data) : data,
    compressed: compress,
  };

  return encoded;
}

/**
 * Decode TOON format back to original data
 */
export function decodeFromTOON(toonData: TOONEncoded): TOONDecoded {
  if (!toonData || toonData.format !== 'TOON') {
    throw new Error('Invalid TOON format');
  }

  const original = toonData.compressed
    ? decompressData(toonData.data)
    : toonData.data;

  // Estimate token counts (rough approximation)
  const originalTokens = estimateTokens(JSON.stringify(original));
  const compressedTokens = estimateTokens(JSON.stringify(toonData.data));

  return {
    original,
    metadata: {
      compressionRatio:
        originalTokens > 0 ? compressedTokens / originalTokens : 1,
      originalTokens,
      compressedTokens,
      format: toonData.format,
    },
  };
}

/**
 * Compress data for more efficient token usage
 */
function compressData(data: any): any {
  if (typeof data === 'object' && data !== null) {
    if (Array.isArray(data)) {
      return data.map(compressData);
    }

    const compressed: any = {};
    for (const [key, value] of Object.entries(data)) {
      // Use short keys where possible
      const shortKey = getShortKey(key);
      compressed[shortKey] = compressData(value);
    }
    return compressed;
  }

  return data;
}

/**
 * Decompress data back to original format
 */
function decompressData(data: any): any {
  if (typeof data === 'object' && data !== null) {
    if (Array.isArray(data)) {
      return data.map(decompressData);
    }

    const decompressed: any = {};
    for (const [key, value] of Object.entries(data)) {
      // Convert short keys back to full keys
      const fullKey = getFullKey(key);
      decompressed[fullKey] = decompressData(value);
    }
    return decompressed;
  }

  return data;
}

/**
 * Get short key representation
 */
function getShortKey(fullKey: string): string {
  const keyMappings: Record<string, string> = {
    compliance_score: 'cs',
    pass_fail: 'pf',
    feedback_message: 'fm',
    items: 'i',
    criterion_number: 'cn',
    compliant: 'c',
    confidence: 'cf',
    message: 'm',
    reason: 'r',
    inputTokens: 'it',
    outputTokens: 'ot',
    cost: 'ct',
    latency: 'lt',
    technique: 'tc',
    compressionRatio: 'cr',
  };

  return keyMappings[fullKey] || fullKey;
}

/**
 * Get full key from short representation
 */
function getFullKey(shortKey: string): string {
  const reverseMappings: Record<string, string> = {
    cs: 'compliance_score',
    pf: 'pass_fail',
    fm: 'feedback_message',
    i: 'items',
    cn: 'criterion_number',
    c: 'compliant',
    cf: 'confidence',
    m: 'message',
    r: 'reason',
    it: 'inputTokens',
    ot: 'outputTokens',
    ct: 'cost',
    lt: 'latency',
    tc: 'technique',
    cr: 'compressionRatio',
  };

  return reverseMappings[shortKey] || shortKey;
}

/**
 * Estimate token count for a string
 */
function estimateTokens(text: string): number {
  // Rough estimation: ~4 characters per token
  return Math.ceil(text.length / 4);
}

/**
 * Check if data is already in TOON format
 */
export function isTOONFormat(data: any): boolean {
  return (
    data &&
    typeof data === 'object' &&
    data.format === 'TOON' &&
    data.version &&
    data.data !== undefined
  );
}
