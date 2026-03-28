import * as crypto from 'crypto';
import { BadRequestException } from '@nestjs/common';

/** OAuth round-trip state (signed with HMAC; no server-side cache). */
export interface OAuthStateData {
  provider: 'google' | 'github';
  userId?: string;
  nonce: string;
  timestamp: number;
}

/** Normalize `state` query param for base64 decode (spaces, padding). */
export function normalizeOAuthStateParam(rawState: string): string {
  let normalizedState = rawState.replace(/\s/g, '+');
  while (normalizedState.length % 4 !== 0) {
    normalizedState += '=';
  }
  return normalizedState;
}

export function serializeStateForSigning(data: OAuthStateData): string {
  const o: Record<string, string | number> = {
    provider: data.provider,
    nonce: data.nonce,
    timestamp: data.timestamp,
  };
  if (data.userId) {
    o.userId = data.userId;
  }
  return JSON.stringify(o);
}

export function signOAuthState(stateData: OAuthStateData, secret: string): string {
  const payload = serializeStateForSigning(stateData);
  const sig = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  const wire = JSON.stringify({
    ...(JSON.parse(payload) as Record<string, unknown>),
    sig,
  });
  return Buffer.from(wire, 'utf8').toString('base64');
}

export function verifyOAuthState(
  rawState: string,
  secret: string,
): OAuthStateData {
  const normalized = normalizeOAuthStateParam(rawState);
  let decoded: string;
  try {
    const normalizedUrl = normalized.replace(/-/g, '+').replace(/_/g, '/');
    decoded = Buffer.from(normalizedUrl, 'base64').toString('utf-8');
  } catch {
    throw new BadRequestException('Invalid OAuth state encoding');
  }
  let parsed: {
    sig: string;
    provider: string;
    nonce: string;
    timestamp: number;
    userId?: string;
  };
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new BadRequestException('Invalid OAuth state payload');
  }
  if (!parsed?.sig || typeof parsed.sig !== 'string') {
    throw new BadRequestException('Invalid OAuth state signature');
  }
  const { sig, ...rest } = parsed;
  const stateData: OAuthStateData = {
    provider: rest.provider as 'google' | 'github',
    nonce: rest.nonce,
    timestamp: rest.timestamp,
    ...(rest.userId ? { userId: rest.userId } : {}),
  };
  const payload = serializeStateForSigning(stateData);
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  const sigBuf = Buffer.from(sig, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (
    sigBuf.length !== expBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expBuf)
  ) {
    throw new BadRequestException('Invalid OAuth state signature');
  }
  return stateData;
}
