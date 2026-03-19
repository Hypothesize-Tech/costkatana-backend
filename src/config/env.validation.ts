/**
 * Environment variable validation.
 * Logs warnings for missing or insecure values instead of throwing.
 * Allows the container to start; downstream features may fail if vars are missing.
 */

import { Logger } from '@nestjs/common';

const REQUIRED_ENV_VARS = [
  'MONGODB_URI',
  'JWT_SECRET',
  'ENCRYPTION_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'INTERNAL_MFA_ENCRYPTION_KEY',
] as const;

const logger = new Logger('EnvValidation');

export function validateEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    const list = missing.join(', ');
    logger.warn(
      `Missing required environment variable(s): ${list}. Some features may not work.`,
    );
  }

  const JWT_SECRET = process.env.JWT_SECRET?.trim();
  if (JWT_SECRET === 'default-secret') {
    logger.warn(
      'JWT_SECRET uses insecure default-secret placeholder. Set a secure value in production.',
    );
  }

  const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY?.trim();
  const insecureEncryptionKeys = [
    'default-encryption-key-change-this',
    'default-encryption-key-for-development-only',
    'default-key-change-me',
    'your-32-character-encryption-key',
  ];
  if (ENCRYPTION_KEY && insecureEncryptionKeys.includes(ENCRYPTION_KEY)) {
    logger.warn(
      'ENCRYPTION_KEY uses a placeholder value. Set a secure 32+ character key in production.',
    );
  }
}
