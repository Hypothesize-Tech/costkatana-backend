/**
 * Backup Service (NestJS)
 *
 * Production service for MongoDB database backups: local dump, S3 upload,
 * retention cleanup, and statistics. Full parity with Express backupService.
 */

import { Injectable } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { LoggerService } from '../../common/logger/logger.service';

const execAsync = promisify(exec);

export interface BackupConfig {
  enableBackup: boolean;
  intervalHours: number;
  localPath: string;
  retentionDays: number;
  s3Bucket: string;
  s3Region: string;
  s3Prefix: string;
  mongodbUri: string;
  dumpOptions: string;
  compression: string;
}

export interface BackupResult {
  success: boolean;
  localPath?: string;
  s3Key?: string;
  size?: number;
  error?: string;
  timestamp: Date;
}

export interface BackupStats {
  localBackups: number;
  localSize: number;
  s3Backups: number;
  lastBackup?: Date;
}

@Injectable()
export class BackupService {
  private s3Client: S3Client | null = null;
  private readonly config: BackupConfig;

  constructor(private readonly logger: LoggerService) {
    this.config = this.loadConfig();

    if (
      this.config.enableBackup &&
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY
    ) {
      try {
        this.s3Client = new S3Client({
          region: this.config.s3Region,
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          },
        });
      } catch (error) {
        this.logger.warn('Failed to initialize S3 client for backups', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  private loadConfig(): BackupConfig {
    const mongodbUri =
      process.env.NODE_ENV === 'production'
        ? (process.env.MONGODB_URI_PROD ?? process.env.MONGODB_URI)
        : process.env.MONGODB_URI;
    return {
      enableBackup: process.env.ENABLE_DB_BACKUP === 'true',
      intervalHours: parseInt(process.env.BACKUP_INTERVAL_HOURS ?? '12', 10),
      localPath: process.env.BACKUP_LOCAL_PATH ?? './backups',
      retentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS ?? '30', 10),
      s3Bucket: process.env.BACKUP_S3_BUCKET ?? 'cost-katana-backups',
      s3Region: process.env.BACKUP_S3_REGION ?? 'us-east-1',
      s3Prefix: process.env.BACKUP_S3_PREFIX ?? 'database-backups',
      mongodbUri: mongodbUri ?? 'mongodb://localhost:27017/cost-katana',
      dumpOptions: process.env.MONGODB_DUMP_OPTIONS ?? '--gzip --archive',
      compression: process.env.BACKUP_COMPRESSION ?? 'gzip',
    };
  }

  /**
   * Perform a complete database backup: local dump, compress, upload to S3.
   */
  async performBackup(): Promise<BackupResult> {
    if (!this.config.enableBackup) {
      this.logger.log('Database backup is disabled');
      return {
        success: false,
        error: 'Backup is disabled',
        timestamp: new Date(),
      };
    }

    const timestamp = new Date();
    const backupName = `backup-${timestamp.toISOString().replace(/[:.]/g, '-')}`;

    try {
      this.logger.log(`Starting database backup: ${backupName}`);

      await this.ensureBackupDirectory();

      const localBackupPath = await this.createMongoDump(backupName);

      const s3Key = await this.uploadToS3(localBackupPath, backupName);

      const stats = await fs.stat(localBackupPath);

      this.logger.log(`Backup completed successfully: ${backupName}`);

      return {
        success: true,
        localPath: localBackupPath,
        s3Key,
        size: stats.size,
        timestamp,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Backup failed: ${errorMessage}`, { error });

      return {
        success: false,
        error: errorMessage,
        timestamp,
      };
    }
  }

  /**
   * Create MongoDB dump and compress to .gz in local backup directory.
   */
  private async createMongoDump(backupName: string): Promise<string> {
    const fileName = `${backupName}.gz`;
    const filePath = path.join(this.config.localPath, fileName);

    const dbName = this.extractDatabaseName(this.config.mongodbUri);

    const command = `mongodump --uri="${this.config.mongodbUri}" --db="${dbName}" ${this.config.dumpOptions} --out="${this.config.localPath}/${backupName}"`;

    this.logger.log(`Executing mongodump for backup: ${backupName}`);

    try {
      await execAsync(command);

      const compressCommand = `tar -czf "${filePath}" -C "${this.config.localPath}" "${backupName}"`;
      await execAsync(compressCommand);

      await fs.rm(path.join(this.config.localPath, backupName), {
        recursive: true,
        force: true,
      });

      this.logger.log(`MongoDB dump created: ${filePath}`);
      return filePath;
    } catch (error) {
      throw new Error(
        `MongoDB dump failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Upload backup file to S3.
   */
  private async uploadToS3(
    localPath: string,
    _backupName: string,
  ): Promise<string> {
    if (!this.s3Client) {
      throw new Error(
        'S3 client not initialized - check AWS credentials and ENABLE_DB_BACKUP',
      );
    }

    const fileName = path.basename(localPath);
    const s3Key = `${this.config.s3Prefix}/${fileName}`;

    try {
      const fileContent = await fs.readFile(localPath);

      const command = new PutObjectCommand({
        Bucket: this.config.s3Bucket,
        Key: s3Key,
        Body: fileContent,
        ContentType: 'application/gzip',
        Metadata: {
          'backup-date': new Date().toISOString(),
          database: this.extractDatabaseName(this.config.mongodbUri),
          compression: this.config.compression,
        },
      });

      await this.s3Client.send(command);

      this.logger.log(
        `Backup uploaded to S3: s3://${this.config.s3Bucket}/${s3Key}`,
      );
      return s3Key;
    } catch (error) {
      throw new Error(
        `S3 upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Clean up old backups (local and S3) per retention policy.
   */
  async cleanupOldBackups(): Promise<void> {
    try {
      await this.cleanupLocalBackups();
      await this.cleanupS3Backups();
      this.logger.log('Old backups cleaned up successfully');
    } catch (error) {
      this.logger.error(
        `Cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  private async cleanupLocalBackups(): Promise<void> {
    let files: string[];
    try {
      files = await fs.readdir(this.config.localPath);
    } catch {
      return;
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);

    for (const file of files) {
      if (
        file.startsWith('backup-') &&
        (file.endsWith('.gz') || file.endsWith('.tar'))
      ) {
        const filePath = path.join(this.config.localPath, file);
        const stats = await fs.stat(filePath);

        if (stats.mtime < cutoffDate) {
          await fs.unlink(filePath);
          this.logger.log(`Deleted old local backup: ${file}`);
        }
      }
    }
  }

  private async cleanupS3Backups(): Promise<void> {
    if (!this.s3Client) {
      this.logger.warn('S3 client not initialized - skipping S3 cleanup');
      return;
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);

    try {
      const listCommand = new ListObjectsV2Command({
        Bucket: this.config.s3Bucket,
        Prefix: this.config.s3Prefix,
      });

      const response = await this.s3Client.send(listCommand);

      if (response.Contents) {
        for (const object of response.Contents) {
          if (
            object.Key &&
            object.LastModified &&
            object.LastModified < cutoffDate
          ) {
            const deleteCommand = new DeleteObjectCommand({
              Bucket: this.config.s3Bucket,
              Key: object.Key,
            });
            await this.s3Client.send(deleteCommand);
            this.logger.log(`Deleted old S3 backup: ${object.Key}`);
          }
        }
      }
    } catch (error) {
      this.logger.error(
        `S3 cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  private async ensureBackupDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.config.localPath, { recursive: true });
    } catch (error) {
      throw new Error(
        `Failed to create backup directory: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  private extractDatabaseName(uri: string): string {
    const match = uri.match(/\/([^/?]+)(\?|$)/);
    return match ? match[1] : 'cost-katana';
  }

  /**
   * Get backup statistics (local count/size, S3 count, last backup time).
   */
  async getBackupStats(): Promise<BackupStats> {
    const stats: BackupStats = {
      localBackups: 0,
      localSize: 0,
      s3Backups: 0,
      lastBackup: undefined,
    };

    try {
      let files: string[];
      try {
        files = await fs.readdir(this.config.localPath);
      } catch {
        files = [];
      }

      let lastBackupTime = 0;

      for (const file of files) {
        if (
          file.startsWith('backup-') &&
          (file.endsWith('.gz') || file.endsWith('.tar'))
        ) {
          const filePath = path.join(this.config.localPath, file);
          const fileStats = await fs.stat(filePath);

          stats.localBackups++;
          stats.localSize += fileStats.size;

          if (fileStats.mtime.getTime() > lastBackupTime) {
            lastBackupTime = fileStats.mtime.getTime();
            stats.lastBackup = fileStats.mtime;
          }
        }
      }

      if (this.s3Client) {
        const command = new ListObjectsV2Command({
          Bucket: this.config.s3Bucket,
          Prefix: this.config.s3Prefix,
        });
        const response = await this.s3Client.send(command);
        stats.s3Backups = response.Contents?.length ?? 0;
      }
    } catch (error) {
      this.logger.error(
        `Failed to get backup stats: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

    return stats;
  }
}
