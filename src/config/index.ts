import appConfig from './app.config';

export { ConfigModule } from './config.module';
export { validateEnv } from './env.validation';
export { default as appConfig } from './app.config';
/** Singleton config object for modules that need direct access (logger, webhook, etc.) */
export const config = appConfig();
export type {
  AppConfig,
  CorsConfig,
  JwtConfig,
  RedisConfig,
} from './app.config';
