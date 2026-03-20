import { Request } from 'express';

/** Path prefixes the gateway strips before appending to CostKatana-Target-Url origin */
const GATEWAY_PATH_PREFIXES = ['/api/gateway', '/gateway'] as const;

/**
 * Returns the provider-facing path (e.g. `/v1/messages`) without the gateway mount prefix.
 */
export function stripGatewayPrefixFromPath(path: string): string {
  let p = (path.split('?')[0] || path).trim();
  const lower = p.toLowerCase();
  for (const prefix of GATEWAY_PATH_PREFIXES) {
    if (lower.startsWith(prefix.toLowerCase())) {
      p = p.slice(prefix.length);
      break;
    }
  }
  if (!p.startsWith('/')) {
    p = `/${p}`;
  }
  return p;
}

/**
 * Infer default provider origin when `CostKatana-Target-Url` is omitted.
 * Uses the normalized (gateway-stripped) path only.
 */
export function inferDefaultTargetUrlFromPath(normalizedPath: string): string | undefined {
  const path = normalizedPath.toLowerCase();

  if (/\/v1\/messages(\/|$|\?)/.test(path)) {
    return 'https://api.anthropic.com';
  }

  if (path.includes('generatecontent') || path.includes('streamgeneratecontent')) {
    return 'https://generativelanguage.googleapis.com';
  }

  if (/\/model\/[^/]+\/(invoke|invoke-with-response-stream)(\/|$|\?)/.test(path)) {
    const region =
      process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
    return `https://bedrock-runtime.${region}.amazonaws.com`;
  }

  if (path.includes('/v1/rerank') || path.includes('/v1/generate')) {
    return 'https://api.cohere.ai';
  }

  if (path.includes('/v1/embeddings')) {
    return 'https://api.openai.com';
  }

  if (path.includes('/v1/embed')) {
    return 'https://api.cohere.ai';
  }

  if (path.startsWith('/v1/')) {
    return 'https://api.openai.com';
  }

  return undefined;
}

/**
 * Infer `CostKatana-Target-Url` (origin/base) from the incoming HTTP request path.
 */
export function inferGatewayTargetUrlForRequest(request: Request): string | undefined {
  const rawPath = request.path || '';
  const normalized = stripGatewayPrefixFromPath(rawPath);
  return inferDefaultTargetUrlFromPath(normalized);
}
