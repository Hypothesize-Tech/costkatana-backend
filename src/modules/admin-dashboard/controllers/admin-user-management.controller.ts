import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ControllerHelper } from '../../../common/services/controller-helper.service';
import { AdminUserManagementService } from '../services/admin-user-management.service';
import {
  UserManagementFiltersDto,
  UpdateUserStatusDto,
  UpdateUserRoleDto,
  UserDetailParamsDto,
} from '../dto/user-management.dto';

@Controller('api/admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminUserManagementController {
  private readonly logger = new Logger(AdminUserManagementController.name);

  constructor(
    private readonly adminUserManagementService: AdminUserManagementService,
    private readonly controllerHelper: ControllerHelper,
  ) {}

  /**
   * Get user statistics (must be before :userId route)
   * GET /api/admin/users/stats
   */
  @Get('stats')
  async getUserStats(@CurrentUser() user: { id: string }) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getUserStats');

      const stats = await this.adminUserManagementService.getUserStats();

      this.controllerHelper.logRequestSuccess('getUserStats', startTime, {
        adminUserId: user.id,
      });

      return {
        success: true,
        data: stats,
      };
    } catch (error: any) {
      this.controllerHelper.handleError('getUserStats', error, startTime);
    }
  }

  /**
   * Get all users (admin management)
   * GET /api/admin/users
   */
  @Get()
  async getAllUsers(@Query() query: UserManagementFiltersDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getAllUsers');

      const filters = {
        search: query.search,
        role: query.role,
        isActive: query.isActive,
        emailVerified: query.emailVerified,
        subscriptionPlan: query.subscriptionPlan,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
        limit: query.limit,
        offset: query.offset,
      };

      const users = await this.adminUserManagementService.getAllUsers(filters);

      this.controllerHelper.logRequestSuccess('getAllUsers', startTime, {
        count: users.length,
      });

      return {
        success: true,
        data: users,
      };
    } catch (error: any) {
      this.controllerHelper.handleError('getAllUsers', error, startTime);
    }
  }

  /**
   * Get user detail
   * GET /api/admin/users/:userId
   */
  @Get(':userId')
  async getUserDetail(@Param() params: UserDetailParamsDto) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('getUserDetail');

      const user = await this.adminUserManagementService.getUserDetail(
        params.userId,
      );

      if (!user) {
        throw new NotFoundException('User not found');
      }

      this.controllerHelper.logRequestSuccess('getUserDetail', startTime, {
        userId: params.userId,
      });

      return {
        success: true,
        data: user,
      };
    } catch (error: any) {
      this.controllerHelper.handleError('getUserDetail', error, startTime);
    }
  }

  /**
   * Update user status
   * PATCH /api/admin/users/:userId/status
   */
  @Patch(':userId/status')
  async updateUserStatus(
    @Param() params: UserDetailParamsDto,
    @Body() body: UpdateUserStatusDto,
    @CurrentUser() currentUser: any,
  ) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('updateUserStatus');

      const adminUserId = currentUser.id;
      const { userId } = params;
      const { isActive } = body;

      const updated = await this.adminUserManagementService.updateUserStatus(
        userId,
        isActive,
      );

      if (!updated) {
        throw new NotFoundException('User not found');
      }

      this.controllerHelper.logRequestSuccess('updateUserStatus', startTime, {
        adminUserId,
        userId,
        isActive,
      });

      return {
        success: true,
        message: `User ${isActive ? 'activated' : 'suspended'} successfully`,
      };
    } catch (error: any) {
      this.controllerHelper.handleError('updateUserStatus', error, startTime);
    }
  }

  /**
   * Update user role
   * PATCH /api/admin/users/:userId/role
   */
  @Patch(':userId/role')
  async updateUserRole(
    @Param() params: UserDetailParamsDto,
    @Body() body: UpdateUserRoleDto,
    @CurrentUser() currentUser: any,
  ) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('updateUserRole');

      const adminUserId = currentUser.id;
      const { userId } = params;
      const { role } = body;

      const updated = await this.adminUserManagementService.updateUserRole(
        userId,
        role,
      );

      if (!updated) {
        throw new NotFoundException('User not found');
      }

      this.controllerHelper.logRequestSuccess('updateUserRole', startTime, {
        adminUserId,
        userId,
        role,
      });

      return {
        success: true,
        message: 'User role updated successfully',
      };
    } catch (error: any) {
      this.controllerHelper.handleError('updateUserRole', error, startTime);
    }
  }

  /**
   * Delete user (soft delete)
   * DELETE /api/admin/users/:userId
   */
  @Delete(':userId')
  async deleteUser(
    @Param() params: UserDetailParamsDto,
    @CurrentUser() currentUser: any,
  ) {
    const startTime = Date.now();
    try {
      this.controllerHelper.logRequestStart('deleteUser');

      const adminUserId = currentUser.id;
      const { userId } = params;

      // Prevent deleting yourself
      if (userId === adminUserId) {
        throw new BadRequestException('You cannot delete your own account');
      }

      const deleted = await this.adminUserManagementService.deleteUser(userId);

      if (!deleted) {
        throw new NotFoundException('User not found');
      }

      this.controllerHelper.logRequestSuccess('deleteUser', startTime, {
        adminUserId,
        userId,
      });

      return {
        success: true,
        message: 'User deleted successfully',
      };
    } catch (error: any) {
      this.controllerHelper.handleError('deleteUser', error, startTime);
    }
  }
}
