/**
 * Token counting utilities
 */

export function estimateTokens(text: string): number {
  // Rough estimation: 1 token ≈ 4 characters for English text
  // This is a simple approximation - real tokenization is more complex
  if (!text || typeof text !== 'string') {
    return 0;
  }

  // Clean the text
  const cleanText = text.trim();

  // Count characters and estimate tokens
  // Average of ~4 characters per token for English
  const charCount = cleanText.length;
  const estimatedTokens = Math.ceil(charCount / 4);

  // Add some overhead for special characters, formatting, etc.
  const overhead = Math.ceil(estimatedTokens * 0.1);

  return estimatedTokens + overhead;
}

export function countWords(text: string): number {
  if (!text || typeof text !== 'string') {
    return 0;
  }

  // Split by whitespace and filter out empty strings
  return text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
}

export function estimateTokensFromWords(wordCount: number): number {
  // Rough approximation: 1.3 tokens per word on average
  return Math.ceil(wordCount * 1.3);
}

export function estimateTokensForImage(
  width: number = 512,
  height: number = 512,
): number {
  // Rough estimation for image tokens
  // Different models have different tokenization for images
  // This is a simple approximation
  const pixels = width * height;
  const tokensPerPixel = 0.001; // Very rough approximation
  return Math.ceil(pixels * tokensPerPixel);
}

export function estimateTokensForMessages(
  messages: Array<{ role: string; content: string }>,
): number {
  let totalTokens = 0;

  for (const message of messages) {
    // Add tokens for role indicator
    totalTokens += 10; // Rough estimate for role metadata

    // Add tokens for content
    totalTokens += estimateTokens(message.content);

    // Add spacing/formatting overhead
    totalTokens += 5;
  }

  return totalTokens;
}
