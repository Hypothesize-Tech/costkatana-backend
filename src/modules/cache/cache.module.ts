import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { UserSessionModule } from '../user-session/user-session.module';
import { CacheController } from './cache.controller';

/**
 * Cache Module (NestJS)
 *
 * Provides cache management API: stats, clear, export, import, warmup.
 * Uses CommonModule for CacheService and BusinessEventLoggingService.
 * Uses AuthModule for JWT + User model (JwtAuthGuard).
 * Uses UserSessionModule for UserSessionService (JwtAuthGuard).
 */
@Module({
  imports: [ConfigModule, AuthModule, UserSessionModule],
  controllers: [CacheController],
})
export class CacheModule {}
