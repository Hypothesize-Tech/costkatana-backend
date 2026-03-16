/**
 * Backup Module (NestJS)
 *
 * Database backup: scheduler, manual trigger, status, and statistics.
 * Full parity with Express backup routes and services.
 */

import { Module } from '@nestjs/common';
import { BackupService } from './backup.service';
import { BackupSchedulerService } from './backup-scheduler.service';
import { BackupController } from './backup.controller';

@Module({
  controllers: [BackupController],
  providers: [BackupService, BackupSchedulerService],
  exports: [BackupService, BackupSchedulerService],
})
export class BackupModule {}
