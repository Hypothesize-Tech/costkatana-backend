/**
 * Environment variable validation.
 * Fails fast on startup if required variables are missing.
 */
const REQUIRED_ENV_VARS = [
  'MONGODB_URI',
  'JWT_SECRET',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
] as const;

export function validateEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    const list = missing.join(', ');
    throw new Error(`Missing required environment variable(s): ${list}`);
  }
}
