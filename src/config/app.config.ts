/**
 * Application configuration.
 * Mirrors costkatana-backend config shape for easier migration.
 */
export interface AppConfig {
  env: string;
  port: number;
  cors: CorsConfig;
  jwt: JwtConfig;
  rateLimit: RateLimitConfig;
  logging: LoggingConfig;
  encryption: EncryptionConfig;
  redis: RedisConfig;
}

export interface CorsConfig {
  origin:
    | boolean
    | string
    | string[]
    | ((
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean | string) => void,
      ) => void);
  credentials: boolean;
  methods: string[];
  allowedHeaders: string[];
  exposedHeaders: string[];
  preflightContinue: boolean;
  optionsSuccessStatus: number;
}

export interface JwtConfig {
  secret: string;
  expiresIn: string;
  refreshSecret: string;
  refreshExpiresIn: string;
}

export interface RateLimitConfig {
  windowMs: number;
  max: number;
}

export interface LoggingConfig {
  level: string;
  filePath: string;
}

export interface EncryptionConfig {
  key: string;
}

export interface RedisConfig {
  host: string;
  port: number;
  password: string | undefined;
  db: number;
  url: string | undefined;
  prefix: string;
  enableOfflineQueue: boolean;
  maxRetriesPerRequest: number | null;
  connectTimeout: number;
  disconnectTimeout: number;
  lazyConnect: boolean;
  tls: object | undefined;
}

export default (): AppConfig => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '8000', 10),
  cors: (() => {
    const corsOrigin = process.env.CORS_ORIGIN?.trim();
    const frontendUrl = (
      process.env.FRONTEND_URL || 'http://localhost:3000'
    ).replace(/\/$/, '');
    const isDev = process.env.NODE_ENV !== 'production';

    // CORS_ORIGIN=* or empty: allow all origins by reflecting (required when credentials: true)
    // CORS_ORIGIN specific: comma-separated list of allowed origins
    const allowedOrigins =
      corsOrigin && corsOrigin !== '*'
        ? corsOrigin
            .split(',')
            .map((o) => o.trim())
            .filter(Boolean)
        : null;

    const originHandler: CorsConfig['origin'] = allowedOrigins
      ? (
          origin: string | undefined,
          callback: (err: Error | null, allow?: boolean | string) => void,
        ) => {
          if (!origin) return callback(null, true);
          const allowed = allowedOrigins.some((a) => a === origin || a === '*');
          callback(null, allowed ? origin : false);
        }
      : (
          origin: string | undefined,
          callback: (err: Error | null, allow?: boolean | string) => void,
        ) => {
          // Reflect request origin when credentials: true (cannot use *)
          if (!origin) return callback(null, true);
          if (isDev) {
            // In development: allow localhost, 127.0.0.1, and FRONTEND_URL
            const isLocal =
              origin.startsWith('http://localhost:') ||
              origin.startsWith('http://127.0.0.1:') ||
              origin === frontendUrl ||
              origin.startsWith(frontendUrl + '/');
            if (isLocal) return callback(null, origin);
          }
          callback(null, origin);
        };

    return {
      origin: originHandler,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'CostKatana-Auth',
        'CostKatana-Project-Id',
        'User-Agent',
        'Accept',
        'Cache-Control',
        'Pragma',
        'X-Requested-With',
        'X-Request-Id',
      ],
      exposedHeaders: [
        'X-Response-Time-Priority',
        'Cache-Control',
        'X-Request-Id',
        'Content-Type',
        'X-Accel-Buffering',
      ],
      preflightContinue: false,
      optionsSuccessStatus: 204,
    };
  })(),
  jwt: {
    secret: process.env.JWT_SECRET!,
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? process.env.JWT_SECRET!,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '900000', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS ?? '100', 10),
  },
  logging: {
    level: process.env.LOG_LEVEL ?? 'info',
    filePath: process.env.LOG_FILE_PATH ?? './logs',
  },
  encryption: {
    key: process.env.ENCRYPTION_KEY ?? 'default-encryption-key-change-this',
  },
  redis: {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB ?? '0', 10),
    url: process.env.REDIS_URL,
    prefix: 'bull',
    enableOfflineQueue: true,
    maxRetriesPerRequest: null,
    connectTimeout: 5000,
    disconnectTimeout: 2000,
    lazyConnect: true,
    tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
  },
});
