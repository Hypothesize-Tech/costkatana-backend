/**
 * EncryptionEnvelopeService — KMS-ready versioned AES-256-GCM envelope.
 *
 * The legacy `EncryptionService` reads a single `ENCRYPTION_KEY` and
 * stores ciphertext as a `iv:authTag:encrypted` string. That means a
 * key rotation requires re-encrypting every row in lock-step, which
 * gets very risky at scale.
 *
 * This service stores a versioned envelope:
 *
 *   {
 *     v: 1,                  // key version that was used to encrypt
 *     iv: "<hex>",           // 12-byte IV
 *     tag: "<hex>",          // GCM auth tag
 *     ct: "<hex>",           // ciphertext
 *   }
 *
 * Encryption always uses the key whose version is `ENCRYPTION_KEY_VERSION`
 * (or the current key version derived from env). Decryption picks the key
 * matching the envelope's `v`. Old envelopes keep working forever (as
 * long as their key material is still present in env), and we can rotate
 * by introducing a new `ENCRYPTION_KEY_V{n+1}` and bumping
 * `ENCRYPTION_KEY_VERSION` — existing rows decrypt with their old key,
 * new writes go through the new key, and a background re-encryption
 * job can lazily upgrade rows on access.
 *
 * KMS readiness: the same envelope shape works whether keys come from
 * env vars or from KMS-DataKey. To migrate to KMS later, swap the
 * `keyByVersion` source for a KMS Decrypt call (the key version then
 * names the *KMS key alias version*, not an env-var key).
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM recommends 12 bytes
const KEY_BYTES = 32;

export interface EncryptionEnvelope {
  /** Key version used to produce this envelope. */
  v: number;
  /** Initialization vector, hex. */
  iv: string;
  /** GCM auth tag, hex. */
  tag: string;
  /** Ciphertext, hex. */
  ct: string;
}

@Injectable()
export class EncryptionEnvelopeService {
  private readonly logger = new Logger(EncryptionEnvelopeService.name);
  private readonly keyByVersion = new Map<number, Buffer>();
  private readonly currentVersion: number;

  constructor(private readonly configService: ConfigService) {
    // Discover all `ENCRYPTION_KEY_V<n>` env vars so legacy envelopes
    // keep decoding after a rotation. The highest discovered version is
    // the current encryption version unless `ENCRYPTION_KEY_VERSION`
    // explicitly pins a different one.
    for (const [name, raw] of Object.entries(process.env)) {
      const m = name.match(/^ENCRYPTION_KEY_V(\d+)$/);
      if (m && raw) {
        const v = Number(m[1]);
        this.keyByVersion.set(v, this.deriveKey(raw));
      }
    }
    // Backwards compat: the original singleton key becomes V1 when no
    // versioned key is configured. This means existing deployments
    // upgrade to envelope-shaped storage without any env changes.
    if (!this.keyByVersion.has(1)) {
      const legacy =
        this.configService.get<{ key?: string }>('encryption')?.key ||
        process.env.ENCRYPTION_KEY;
      if (legacy) {
        this.keyByVersion.set(1, this.deriveKey(legacy));
      }
    }
    if (this.keyByVersion.size === 0) {
      throw new Error(
        'No encryption keys configured. Set ENCRYPTION_KEY (legacy) ' +
          'or ENCRYPTION_KEY_V1+ to enable EncryptionEnvelopeService.',
      );
    }
    const pinnedRaw = process.env.ENCRYPTION_KEY_VERSION;
    if (pinnedRaw) {
      const pinned = Number(pinnedRaw);
      if (!this.keyByVersion.has(pinned)) {
        throw new Error(
          `ENCRYPTION_KEY_VERSION=${pinned} but no key material for v${pinned} is loaded.`,
        );
      }
      this.currentVersion = pinned;
    } else {
      this.currentVersion = Math.max(...this.keyByVersion.keys());
    }
    this.logger.log('EncryptionEnvelopeService initialized', {
      versions: [...this.keyByVersion.keys()].sort((a, b) => a - b),
      currentVersion: this.currentVersion,
    });
  }

  /**
   * Pad / truncate the configured key string to 32 bytes. Matches the
   * legacy `EncryptionService` behaviour so existing cipher material is
   * compatible — important for the lazy-migration path.
   */
  private deriveKey(raw: string): Buffer {
    return Buffer.from(raw.padEnd(KEY_BYTES, '0').slice(0, KEY_BYTES));
  }

  /** Encrypt a UTF-8 plaintext using the current key version. */
  encrypt(plaintext: string): EncryptionEnvelope {
    const key = this.keyByVersion.get(this.currentVersion)!;
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const ct = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return {
      v: this.currentVersion,
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      ct: ct.toString('hex'),
    };
  }

  /**
   * Decrypt an envelope. Throws if the envelope's key version is no
   * longer loaded — the operator deleted the key material before
   * re-encrypting that row, which is a bug we want surfaced loudly.
   */
  decrypt(envelope: EncryptionEnvelope): string {
    const key = this.keyByVersion.get(envelope.v);
    if (!key) {
      throw new Error(
        `Cannot decrypt: key v${envelope.v} not loaded. ` +
          `Configure ENCRYPTION_KEY_V${envelope.v} or run the re-encryption migration.`,
      );
    }
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(envelope.iv, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
    const pt = Buffer.concat([
      decipher.update(Buffer.from(envelope.ct, 'hex')),
      decipher.final(),
    ]);
    return pt.toString('utf8');
  }

  /**
   * Returns true when the given envelope is encrypted with a stale key
   * (i.e. an older version than `currentVersion`). Background workers
   * can use this to decide which rows to lazily re-encrypt on access.
   */
  needsReencryption(envelope: EncryptionEnvelope): boolean {
    return envelope.v < this.currentVersion;
  }

  /**
   * Decrypt-then-encrypt with the current key version. Returns a fresh
   * envelope. Useful for migration scripts.
   */
  reencrypt(envelope: EncryptionEnvelope): EncryptionEnvelope {
    if (!this.needsReencryption(envelope)) return envelope;
    return this.encrypt(this.decrypt(envelope));
  }
}
