import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';
import { Usage, UsageSchema } from '@/schemas/core/usage.schema';
import { Project, ProjectSchema } from '@/schemas/team-project/project.schema';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: Usage.name, schema: UsageSchema },
      { name: Project.name, schema: ProjectSchema },
    ]),
  ],
  controllers: [TrackingController],
  providers: [TrackingService],
  exports: [TrackingService],
})
export class TrackingModule {}
