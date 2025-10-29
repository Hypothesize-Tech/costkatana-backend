import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { loggingService } from './logging.service';

const execAsync = promisify(exec);

interface BackupConfig {
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

interface BackupResult {
  success: boolean;
  localPath?: string;
  s3Key?: string;
  size?: number;
  error?: string;
  timestamp: Date;
}

export class BackupService {
  private s3Client: S3Client | null = null;
  private config: BackupConfig;

  constructor() {
    this.config = this.loadConfig();
    
    // Only initialize S3 client if backup is enabled and credentials are present
    if (this.config.enableBackup && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      try {
        this.s3Client = new S3Client({
          region: this.config.s3Region,
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          },
        });
      } catch (error) {
        loggingService.warn('Failed to initialize S3 client for backups', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  }

  private loadConfig(): BackupConfig {
    return {
      enableBackup: process.env.ENABLE_DB_BACKUP === 'true',
      intervalHours: parseInt(process.env.BACKUP_INTERVAL_HOURS ?? '12'),
      localPath: process.env.BACKUP_LOCAL_PATH ?? './backups',
      retentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS ?? '30'),
      s3Bucket: process.env.BACKUP_S3_BUCKET ?? 'cost-katana-backups',
      s3Region: process.env.BACKUP_S3_REGION ?? 'us-east-1',
      s3Prefix: process.env.BACKUP_S3_PREFIX ?? 'database-backups',
      mongodbUri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017/cost-katana',
      dumpOptions: process.env.MONGODB_DUMP_OPTIONS ?? '--gzip --archive',
      compression: process.env.BACKUP_COMPRESSION ?? 'gzip',
    };
  }

  /**
   * Perform a complete database backup
   */
  async performBackup(): Promise<BackupResult> {
    if (!this.config.enableBackup) {
      loggingService.info('Database backup is disabled');
      return {
        success: false,
        error: 'Backup is disabled',
        timestamp: new Date(),
      };
    }

    const timestamp = new Date();
    const backupName = `backup-${timestamp.toISOString().replace(/[:.]/g, '-')}`;
    
    try {
      loggingService.info(`Starting database backup: ${backupName}`);

      // Ensure local backup directory exists
      await this.ensureBackupDirectory();

      // Perform MongoDB dump
      const localBackupPath = await this.createMongoDump(backupName);
      
      // Upload to S3
      const s3Key = await this.uploadToS3(localBackupPath, backupName);
      
      // Get file size
      const stats = await fs.stat(localBackupPath);
      
      loggingService.info(`Backup completed successfully: ${backupName}`);
      
      return {
        success: true,
        localPath: localBackupPath,
        s3Key: s3Key,
        size: stats.size,
        timestamp,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      loggingService.error(`Backup failed: ${errorMessage}`, { error });
      
      return {
        success: false,
        error: errorMessage,
        timestamp,
      };
    }
  }

  /**
   * Create MongoDB dump
   */
  private async createMongoDump(backupName: string): Promise<string> {
    const fileName = `${backupName}.gz`;
    const filePath = path.join(this.config.localPath, fileName);
    
    // Extract database name from URI
    const dbName = this.extractDatabaseName(this.config.mongodbUri);
    
    // Build mongodump command
    const command = `mongodump --uri="${this.config.mongodbUri}" --db="${dbName}" ${this.config.dumpOptions} --out="${this.config.localPath}/${backupName}"`;
    
    loggingService.info(`Executing mongodump: ${command}`);
    
    try {
      await execAsync(command);
      
      // Compress the dump directory
      const compressCommand = `tar -czf "${filePath}" -C "${this.config.localPath}" "${backupName}"`;
      await execAsync(compressCommand);
      
      // Remove the uncompressed directory
      await fs.rm(path.join(this.config.localPath, backupName), { recursive: true, force: true });
      
      loggingService.info(`MongoDB dump created: ${filePath}`);
      return filePath;
    } catch (error) {
      throw new Error(`MongoDB dump failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Upload backup to S3
   */
  private async uploadToS3(localPath: string, _backupName: string): Promise<string> {
    if (!this.s3Client) {
      throw new Error('S3 client not initialized - check AWS credentials');
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
          'database': this.extractDatabaseName(this.config.mongodbUri),
          'compression': this.config.compression,
        },
      });
      
      await this.s3Client.send(command);
      
      loggingService.info(`Backup uploaded to S3: s3://${this.config.s3Bucket}/${s3Key}`);
      return s3Key;
    } catch (error) {
      throw new Error(`S3 upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Clean up old backups (local and S3)
   */
  async cleanupOldBackups(): Promise<void> {
    try {
      // Clean up local backups
      await this.cleanupLocalBackups();
      
      // Clean up S3 backups
      await this.cleanupS3Backups();
      
      loggingService.info('Old backups cleaned up successfully');
    } catch (error) {
      loggingService.error(`Cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Clean up local backups
   */
  private async cleanupLocalBackups(): Promise<void> {
    const files = await fs.readdir(this.config.localPath);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);
    
    for (const file of files) {
      if (file.startsWith('backup-') && (file.endsWith('.gz') || file.endsWith('.tar'))) {
        const filePath = path.join(this.config.localPath, file);
        const stats = await fs.stat(filePath);
        
        if (stats.mtime < cutoffDate) {
          await fs.unlink(filePath);
          loggingService.info(`Deleted old local backup: ${file}`);
        }
      }
    }
  }

  /**
   * Clean up S3 backups
   */
  private async cleanupS3Backups(): Promise<void> {
    if (!this.s3Client) {
      loggingService.warn('S3 client not initialized - skipping S3 cleanup');
      return;
    }
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);
    
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.config.s3Bucket,
        Prefix: this.config.s3Prefix,
      });
      
      const response = await this.s3Client!.send(command);
      
      if (response.Contents) {
        for (const object of response.Contents) {
          if (object.Key && object.LastModified && object.LastModified < cutoffDate) {
            const deleteCommand = new DeleteObjectCommand({
              Bucket: this.config.s3Bucket,
              Key: object.Key,
            });
            
            await this.s3Client!.send(deleteCommand);
            loggingService.info(`Deleted old S3 backup: ${object.Key}`);
          }
        }
      }
    } catch (error) {
      loggingService.error(`S3 cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Ensure backup directory exists
   */
  private async ensureBackupDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.config.localPath, { recursive: true });
    } catch (error) {
      throw new Error(`Failed to create backup directory: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Extract database name from MongoDB URI
   */
  private extractDatabaseName(uri: string): string {
    const match = uri.match(/\/([^/?]+)(\?|$)/);
    return match ? match[1] : 'cost-katana';
  }

  /**
   * Get backup statistics
   */
  async getBackupStats(): Promise<{
    localBackups: number;
    localSize: number;
    s3Backups: number;
    lastBackup?: Date;
  }> {
    const stats = {
      localBackups: 0,
      localSize: 0,
      s3Backups: 0,
      lastBackup: undefined as Date | undefined,
    };

    try {
      // Count local backups
      const files = await fs.readdir(this.config.localPath);
      let lastBackupTime = 0;
      
      for (const file of files) {
        if (file.startsWith('backup-') && (file.endsWith('.gz') || file.endsWith('.tar'))) {
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

      // Count S3 backups
      const command = new ListObjectsV2Command({
        Bucket: this.config.s3Bucket,
        Prefix: this.config.s3Prefix,
      });
      
      const response = await this.s3Client!.send(command);
      stats.s3Backups = response.Contents?.length ?? 0;
      
    } catch (error) {
      loggingService.error(`Failed to get backup stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return stats;
  }
}

export const backupService = new BackupService();
