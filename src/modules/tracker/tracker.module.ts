import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Usage, UsageSchema } from '@/schemas/core/usage.schema';
import { AuthModule } from '../auth/auth.module';
import { UsageModule } from '../usage/usage.module';
import { TrackerController } from './tracker.controller';
import { TrackerService } from './tracker.service';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    MongooseModule.forFeature([{ name: Usage.name, schema: UsageSchema }]),
    UsageModule,
  ],
  controllers: [TrackerController],
  providers: [TrackerService],
  exports: [TrackerService],
})
export class TrackerModule {}
