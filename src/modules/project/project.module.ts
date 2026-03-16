import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Project,
  ProjectSchema,
} from '../../schemas/team-project/project.schema';
import { Usage, UsageSchema } from '../../schemas/core/usage.schema';
import { User, UserSchema } from '../../schemas/user/user.schema';
import { Alert, AlertSchema } from '../../schemas/core/alert.schema';
import {
  ApprovalRequest,
  ApprovalRequestSchema,
} from '../../schemas/misc/approval-request.schema';
import {
  TeamMember,
  TeamMemberSchema,
} from '../../schemas/team-project/team-member.schema';
import { ProjectController } from './project.controller';
import { ProjectService } from './project.service';
import { ActivityModule } from '../activity/activity.module';
import { EmailModule } from '../email/email.module';
import { TeamModule } from '../team/team.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Project.name, schema: ProjectSchema },
      { name: Usage.name, schema: UsageSchema },
      { name: User.name, schema: UserSchema },
      { name: Alert.name, schema: AlertSchema },
      { name: ApprovalRequest.name, schema: ApprovalRequestSchema },
      { name: TeamMember.name, schema: TeamMemberSchema },
    ]),
    ActivityModule,
    EmailModule,
    TeamModule,
    SubscriptionModule,
    AuthModule, // JwtService, User model, UserSession for OptionalJwtAuthGuard / JwtAuthGuard
  ],
  controllers: [ProjectController],
  providers: [ProjectService],
  exports: [ProjectService],
})
export class ProjectModule {}
