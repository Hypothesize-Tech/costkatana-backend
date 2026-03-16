/**
 * Ambient declarations for cache-manager and @nestjs/cache-manager
 * when type resolution fails (e.g. missing or incompatible types).
 */
declare module 'cache-manager' {
  interface Cache {
    get<T>(key: string): Promise<T | undefined>;
    set<T>(key: string, value: T, ttl?: number): Promise<void>;
    del(key: string): Promise<void>;
    reset(): Promise<void>;
    wrap<T>(key: string, fn: () => Promise<T>, ttl?: number): Promise<T>;
  }
  function caching(store: unknown, options?: { ttl?: number }): Promise<Cache>;
}

declare module '@nestjs/cache-manager' {
  import { InjectionToken } from '@nestjs/common';
  export const CACHE_MANAGER: InjectionToken<import('cache-manager').Cache>;
  export interface CacheModuleOptions {
    ttl?: number;
    store?: unknown;
  }
  export class CacheModule {
    static register(options?: CacheModuleOptions): unknown;
    static registerAsync(options: unknown): unknown;
  }
}
