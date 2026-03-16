import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TeamController } from './team.controller';
import { TeamService } from './services/team.service';
import { WorkspaceService } from './services/workspace.service';
import { PermissionService } from './services/permission.service';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import {
  TeamMember,
  TeamMemberSchema,
} from '../../schemas/team-project/team-member.schema';
import {
  Workspace,
  WorkspaceSchema,
} from '../../schemas/user/workspace.schema';
import { User, UserSchema } from '../../schemas/user/user.schema';
import { WorkspaceRoleGuard } from './guards/workspace-role.guard';
import { AdminOrOwnerGuard } from './guards/admin-or-owner.guard';
import { WorkspaceResolverInterceptor } from './interceptors/workspace-resolver.interceptor';

@Module({
  imports: [
    forwardRef(() => AuthModule),
    MongooseModule.forFeature([
      { name: TeamMember.name, schema: TeamMemberSchema },
      { name: Workspace.name, schema: WorkspaceSchema },
      { name: User.name, schema: UserSchema },
    ]),
    EmailModule,
  ],
  controllers: [TeamController],
  providers: [
    TeamService,
    WorkspaceService,
    PermissionService,
    WorkspaceRoleGuard,
    AdminOrOwnerGuard,
    WorkspaceResolverInterceptor,
  ],
  exports: [TeamService, WorkspaceService, PermissionService],
})
export class TeamModule {}
