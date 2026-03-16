import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TeamService } from './services/team.service';
import { WorkspaceService } from './services/workspace.service';
import { PermissionService } from './services/permission.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WorkspaceResolverInterceptor } from './interceptors/workspace-resolver.interceptor';
import { AdminOrOwnerGuard } from './guards/admin-or-owner.guard';
import { RequireWorkspaceRole } from './decorators/require-workspace-role.decorator';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { UpdateMemberPermissionsDto } from './dto/update-member-permissions.dto';
import { UpdateMemberProjectsDto } from './dto/update-member-projects.dto';
import { UpdateWorkspaceSettingsDto } from './dto/update-workspace-settings.dto';
import { DeleteWorkspaceDto } from './dto/delete-workspace.dto';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';
import { SwitchWorkspaceDto } from './dto/switch-workspace.dto';

interface AuthenticatedUser {
  id: string;
  workspaceId?: string;
}

@Controller('api/team')
@UseGuards(JwtAuthGuard)
@UseInterceptors(WorkspaceResolverInterceptor)
export class TeamController {
  private readonly logger = new Logger(TeamController.name);

  constructor(
    private teamService: TeamService,
    private workspaceService: WorkspaceService,
    private permissionService: PermissionService,
  ) {}

  /**
   * Get all workspace members
   * GET /team/members
   */
  @Get('members')
  async getWorkspaceMembers(@CurrentUser() user: AuthenticatedUser) {
    const workspaceId = user.workspaceId;
    if (!workspaceId) {
      throw new NotFoundException('Workspace not found');
    }

    this.logger.log(`Getting workspace members for workspace ${workspaceId}`);
    const members = await this.teamService.getWorkspaceMembers(workspaceId);

    return {
      success: true,
      data: members,
    };
  }

  /**
   * Invite a new member
   * POST /team/invite
   */
  @Post('invite')
  @HttpCode(HttpStatus.CREATED)
  async inviteMember(
    @CurrentUser() user: AuthenticatedUser,
    @Body() inviteMemberDto: InviteMemberDto,
  ) {
    const workspaceId = user.workspaceId;
    if (!workspaceId) {
      throw new NotFoundException('Workspace not found');
    }

    this.logger.log(
      `Inviting member ${inviteMemberDto.email} to workspace ${workspaceId}`,
    );
    const member = await this.teamService.inviteMember(
      workspaceId,
      inviteMemberDto.email,
      inviteMemberDto.role,
      user.id,
      inviteMemberDto.projectIds,
    );

    return {
      success: true,
      message: 'Invitation sent successfully',
      data: member,
    };
  }

  /**
   * Accept an invitation
   * POST /team/accept/:token
   */
  @Post('accept/:token')
  async acceptInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('token') token: string,
  ) {
    this.logger.log(`Accepting invitation with token for user ${user.id}`);
    const member = await this.teamService.acceptInvitation(token, user.id);

    return {
      success: true,
      message: 'Invitation accepted successfully',
      data: member,
    };
  }

  /**
   * Resend an invitation
   * POST /team/resend/:memberId
   */
  @Post('resend/:memberId')
  async resendInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('memberId') memberId: string,
  ) {
    const workspaceId = user.workspaceId;
    if (!workspaceId) {
      throw new NotFoundException('Workspace not found');
    }

    this.logger.log(
      `Resending invitation for member ${memberId} in workspace ${workspaceId}`,
    );
    await this.teamService.resendInvitation(workspaceId, memberId, user.id);

    return {
      success: true,
      message: 'Invitation resent successfully',
    };
  }

  /**
   * Get member details
   * GET /team/members/:memberId
   */
  @Get('members/:memberId')
  async getMemberDetails(
    @CurrentUser() user: AuthenticatedUser,
    @Param('memberId') memberId: string,
  ) {
    const workspaceId = user.workspaceId;
    if (!workspaceId) {
      throw new NotFoundException('Workspace not found');
    }

    this.logger.log(
      `Getting member details for member ${memberId} in workspace ${workspaceId}`,
    );
    const member = await this.teamService.getMemberDetails(
      workspaceId,
      memberId,
    );

    return {
      success: true,
      data: member,
    };
  }

  /**
   * Update member role
   * PUT /team/members/:memberId/role
   */
  @Put('members/:memberId/role')
  @UseGuards(AdminOrOwnerGuard)
  async updateMemberRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('memberId') memberId: string,
    @Body() updateMemberRoleDto: UpdateMemberRoleDto,
  ) {
    const workspaceId = user.workspaceId;
    if (!workspaceId) {
      throw new NotFoundException('Workspace not found');
    }

    this.logger.log(
      `Updating member ${memberId} role to ${updateMemberRoleDto.role} in workspace ${workspaceId}`,
    );
    const member = await this.teamService.updateMemberRole(
      workspaceId,
      memberId,
      updateMemberRoleDto.role,
      user.id,
    );

    return {
      success: true,
      message: 'Member role updated successfully',
      data: member,
    };
  }

  /**
   * Update member permissions
   * PUT /team/members/:memberId/permissions
   */
  @Put('members/:memberId/permissions')
  @UseGuards(AdminOrOwnerGuard)
  async updateMemberPermissions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('memberId') memberId: string,
    @Body() updateMemberPermissionsDto: UpdateMemberPermissionsDto,
  ) {
    const workspaceId = user.workspaceId;
    if (!workspaceId) {
      throw new NotFoundException('Workspace not found');
    }

    this.logger.log(
      `Updating member ${memberId} permissions in workspace ${workspaceId}`,
    );
    const member = await this.teamService.updateMemberPermissions(
      workspaceId,
      memberId,
      updateMemberPermissionsDto.permissions,
      user.id,
    );

    return {
      success: true,
      message: 'Member permissions updated successfully',
      data: member,
    };
  }

  /**
   * Update member projects
   * PUT /team/members/:memberId/projects
   */
  @Put('members/:memberId/projects')
  async updateMemberProjects(
    @CurrentUser() user: AuthenticatedUser,
    @Param('memberId') memberId: string,
    @Body() updateMemberProjectsDto: UpdateMemberProjectsDto,
  ) {
    const workspaceId = user.workspaceId;
    if (!workspaceId) {
      throw new NotFoundException('Workspace not found');
    }

    this.logger.log(
      `Updating member ${memberId} projects in workspace ${workspaceId}`,
    );
    const member = await this.teamService.updateMemberProjects(
      workspaceId,
      memberId,
      updateMemberProjectsDto.projectIds,
      user.id,
    );

    return {
      success: true,
      message: 'Member projects updated successfully',
      data: member,
    };
  }

  /**
   * Remove a member
   * DELETE /team/members/:memberId
   */
  @Delete('members/:memberId')
  async removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('memberId') memberId: string,
  ) {
    const workspaceId = user.workspaceId;
    if (!workspaceId) {
      throw new NotFoundException('Workspace not found');
    }

    this.logger.log(
      `Removing member ${memberId} from workspace ${workspaceId}`,
    );
    await this.teamService.removeMember(workspaceId, memberId, user.id);

    return {
      success: true,
      message: 'Member removed successfully',
    };
  }

  /**
   * Suspend a member
   * POST /team/members/:memberId/suspend
   */
  @Post('members/:memberId/suspend')
  @UseGuards(AdminOrOwnerGuard)
  async suspendMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('memberId') memberId: string,
  ) {
    const workspaceId = user.workspaceId;
    if (!workspaceId) {
      throw new NotFoundException('Workspace not found');
    }

    this.logger.log(
      `Suspending member ${memberId} in workspace ${workspaceId}`,
    );
    const member = await this.teamService.suspendMember(
      workspaceId,
      memberId,
      user.id,
    );

    return {
      success: true,
      message: 'Member suspended successfully',
      data: member,
    };
  }

  /**
   * Reactivate a member
   * POST /team/members/:memberId/reactivate
   */
  @Post('members/:memberId/reactivate')
  @UseGuards(AdminOrOwnerGuard)
  async reactivateMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('memberId') memberId: string,
  ) {
    const workspaceId = user.workspaceId;
    if (!workspaceId) {
      throw new NotFoundException('Workspace not found');
    }

    this.logger.log(
      `Reactivating member ${memberId} in workspace ${workspaceId}`,
    );
    const member = await this.teamService.reactivateMember(
      workspaceId,
      memberId,
      user.id,
    );

    return {
      success: true,
      message: 'Member reactivated successfully',
      data: member,
    };
  }

  /**
   * Get all user's workspaces
   * GET /team/workspaces
   */
  @Get('workspaces')
  async getUserWorkspaces(@CurrentUser() user: AuthenticatedUser) {
    this.logger.log(`Getting workspaces for user ${user.id}`);
    const workspaces = await this.workspaceService.getUserWorkspaces(user.id);

    return {
      success: true,
      data: workspaces,
    };
  }

  /**
   * Switch primary workspace
   * POST /team/workspace/switch
   */
  @Post('workspace/switch')
  async switchWorkspace(
    @CurrentUser() user: AuthenticatedUser,
    @Body() switchWorkspaceDto: SwitchWorkspaceDto,
  ) {
    this.logger.log(
      `Switching user ${user.id} to workspace ${switchWorkspaceDto.workspaceId}`,
    );
    await this.workspaceService.switchPrimaryWorkspace(
      user.id,
      switchWorkspaceDto.workspaceId,
    );

    return {
      success: true,
      message: 'Primary workspace switched successfully',
    };
  }

  /**
   * Transfer workspace ownership
   * POST /team/workspace/transfer
   */
  @Post('workspace/transfer')
  @RequireWorkspaceRole('owner')
  async transferOwnership(
    @CurrentUser() user: AuthenticatedUser,
    @Body() transferOwnershipDto: TransferOwnershipDto,
  ) {
    const workspaceId = user.workspaceId;
    if (!workspaceId) {
      throw new NotFoundException('Workspace not found');
    }

    this.logger.log(
      `Transferring ownership of workspace ${workspaceId} from ${user.id} to ${transferOwnershipDto.newOwnerId}`,
    );
    await this.workspaceService.transferOwnership(
      workspaceId,
      user.id,
      transferOwnershipDto.newOwnerId,
      transferOwnershipDto.password,
    );

    return {
      success: true,
      message: 'Workspace ownership transferred successfully',
    };
  }

  /**
   * Get current workspace details
   * GET /team/workspace
   */
  @Get('workspace')
  async getWorkspaceDetails(@CurrentUser() user: AuthenticatedUser) {
    const workspaceId = user.workspaceId;
    if (!workspaceId) {
      throw new NotFoundException('Workspace not found');
    }

    this.logger.log(`Getting workspace details for workspace ${workspaceId}`);
    const workspace = await this.workspaceService.getWorkspaceDetails(
      workspaceId,
      user.id,
    );

    return {
      success: true,
      data: workspace,
    };
  }

  /**
   * Update workspace settings
   * PUT /team/workspace
   */
  @Put('workspace')
  @RequireWorkspaceRole('admin')
  async updateWorkspace(
    @CurrentUser() user: AuthenticatedUser,
    @Body() updateWorkspaceSettingsDto: UpdateWorkspaceSettingsDto,
  ) {
    const workspaceId = user.workspaceId;
    if (!workspaceId) {
      throw new NotFoundException('Workspace not found');
    }

    this.logger.log(`Updating workspace ${workspaceId} settings`);
    const workspace = await this.workspaceService.updateWorkspaceSettings(
      workspaceId,
      user.id,
      updateWorkspaceSettingsDto,
    );

    return {
      success: true,
      message: 'Workspace settings updated successfully',
      data: workspace,
    };
  }

  /**
   * Delete workspace
   * DELETE /team/workspace
   */
  @Delete('workspace')
  @RequireWorkspaceRole('owner')
  async deleteWorkspace(
    @CurrentUser() user: AuthenticatedUser,
    @Body() deleteWorkspaceDto: DeleteWorkspaceDto,
  ) {
    const workspaceId = user.workspaceId;
    if (!workspaceId) {
      throw new NotFoundException('Workspace not found');
    }

    this.logger.log(`Deleting workspace ${workspaceId}`);
    await this.workspaceService.deleteWorkspace(
      workspaceId,
      user.id,
      deleteWorkspaceDto.password,
    );

    return {
      success: true,
      message: 'Workspace deleted successfully',
    };
  }
}
