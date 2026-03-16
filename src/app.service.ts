import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

@Injectable()
export class AppService implements OnModuleInit {
  private readonly logger = new Logger(AppService.name);

  constructor(
    @InjectConnection() private readonly mongooseConnection: Connection,
  ) {}

  onModuleInit(): void {
    const conn = this.mongooseConnection;
    if (conn.readyState === 1) {
      this.logger.log('MongoDB successfully connected');
      return;
    }
    conn.once('connected', () => {
      this.logger.log('MongoDB successfully connected');
    });
  }

  getHealth(): { status: string } {
    return { status: 'Cost Katana Backend API' };
  }

  getVersion(): { version: string } {
    const version = process.env.npm_package_version ?? '2.0.0';
    return { version };
  }
}
