/**
 * Environment variable validation.
 * Fails fast on startup if required variables are missing.
 * Never fall back to hardcoded defaults for secrets in production.
 */
const REQUIRED_ENV_VARS = [
  'MONGODB_URI',
  'JWT_SECRET',
  'ENCRYPTION_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'INTERNAL_MFA_ENCRYPTION_KEY',
] as const;

export function validateEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    const list = missing.join(', ');
    throw new Error(`Missing required environment variable(s): ${list}`);
  }

  // Reject insecure placeholder values
  const JWT_SECRET = process.env.JWT_SECRET?.trim();
  if (JWT_SECRET === 'default-secret') {
    throw new Error(
      'JWT_SECRET cannot use the default-secret placeholder. Set a secure value in production.',
    );
  }

  const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY?.trim();
  const insecureEncryptionKeys = [
    'default-encryption-key-change-this',
    'default-encryption-key-for-development-only',
    'default-key-change-me',
  ];
  if (ENCRYPTION_KEY && insecureEncryptionKeys.includes(ENCRYPTION_KEY)) {
    throw new Error(
      'ENCRYPTION_KEY cannot use a placeholder value. Set a secure 32+ character key in production.',
    );
  }
}
