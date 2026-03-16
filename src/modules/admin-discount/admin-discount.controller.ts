import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ControllerHelper } from '../../common/services/controller-helper.service';
import { AdminDiscountService } from './admin-discount.service';
import {
  DiscountUsageService,
  DiscountUsageStats,
} from './discount-usage.service';
import {
  AdminDiscountQueryDto,
  CreateDiscountDto,
  UpdateDiscountDto,
  BulkDiscountIdsDto,
} from './dto';

@Controller('api/admin/discounts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminDiscountController {
  constructor(
    private readonly adminDiscountService: AdminDiscountService,
    private readonly discountUsageService: DiscountUsageService,
    private readonly controllerHelper: ControllerHelper,
  ) {}

  /**
   * Get all discounts with pagination and filtering
   * GET /admin/discounts
   */
  @Get()
  async getDiscounts(
    @CurrentUser() user: { id: string },
    @Query() query: AdminDiscountQueryDto,
  ) {
    const startTime = Date.now();
    this.controllerHelper.logRequestStart('getDiscounts', { user }, { query });

    try {
      const result = await this.adminDiscountService.getDiscounts(query);
      this.controllerHelper.logRequestSuccess(
        'getDiscounts',
        { user },
        startTime,
        {
          count: result.discounts.length,
          total: result.pagination.total,
        },
      );
      return {
        success: true,
        data: {
          discounts: result.discounts,
          pagination: result.pagination,
          filters: result.filters,
        },
      };
    } catch (error) {
      this.controllerHelper.handleError(
        'getDiscounts',
        error,
        { user },
        startTime,
      );
    }
  }

  /**
   * Get usage statistics for a discount (must be before :id to match first)
   * GET /admin/discounts/:id/usage
   */
  @Get(':id/usage')
  async getDiscountUsage(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ): Promise<{ success: boolean; data: DiscountUsageStats }> {
    const startTime = Date.now();
    this.controllerHelper.logRequestStart(
      'getDiscountUsage',
      { user },
      { discountId: id },
    );

    try {
      const stats = await this.discountUsageService.getDiscountUsageStats(id);
      this.controllerHelper.logRequestSuccess(
        'getDiscountUsage',
        { user },
        startTime,
        { discountId: id },
      );
      return { success: true, data: stats };
    } catch (error) {
      if (error instanceof Error && error.message === 'Discount not found') {
        throw new NotFoundException('Discount not found');
      }
      this.controllerHelper.handleError(
        'getDiscountUsage',
        error,
        { user },
        startTime,
        { discountId: id },
      );
    }
  }

  /**
   * Get single discount by ID
   * GET /admin/discounts/:id
   */
  @Get(':id')
  async getDiscount(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    const startTime = Date.now();
    this.controllerHelper.logRequestStart(
      'getDiscount',
      { user },
      { discountId: id },
    );

    try {
      const discount = await this.adminDiscountService.getDiscountById(id);
      this.controllerHelper.logRequestSuccess(
        'getDiscount',
        { user },
        startTime,
        { discountId: id },
      );
      return { success: true, data: discount };
    } catch (error) {
      if (error instanceof Error && error.message === 'Discount not found') {
        throw new NotFoundException('Discount not found');
      }
      this.controllerHelper.handleError(
        'getDiscount',
        error,
        { user },
        startTime,
        { discountId: id },
      );
    }
  }

  /**
   * Create new discount
   * POST /admin/discounts
   */
  @Post()
  async createDiscount(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateDiscountDto,
  ) {
    const startTime = Date.now();
    this.controllerHelper.logRequestStart('createDiscount', { user });

    try {
      if (!dto.code || !dto.type || dto.amount === undefined) {
        throw new BadRequestException('Code, type, and amount are required');
      }
      const discount = await this.adminDiscountService.createDiscount(dto);
      this.controllerHelper.logRequestSuccess(
        'createDiscount',
        { user },
        startTime,
        {
          discountId: discount._id,
          code: discount.code,
        },
      );
      return {
        success: true,
        message: 'Discount created successfully',
        data: discount,
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (error instanceof Error && error.message.includes('already exists')) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof Error && error.message.includes('must be')) {
        throw new BadRequestException(error.message);
      }
      this.controllerHelper.handleError(
        'createDiscount',
        error,
        { user },
        startTime,
      );
    }
  }

  /**
   * Update existing discount
   * PUT /admin/discounts/:id
   */
  @Put(':id')
  async updateDiscount(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateDiscountDto,
  ) {
    const startTime = Date.now();
    this.controllerHelper.logRequestStart(
      'updateDiscount',
      { user },
      { discountId: id },
    );

    try {
      const discount = await this.adminDiscountService.updateDiscount(id, dto);
      this.controllerHelper.logRequestSuccess(
        'updateDiscount',
        { user },
        startTime,
        { discountId: id },
      );
      return {
        success: true,
        message: 'Discount updated successfully',
        data: discount,
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'Discount not found') {
        throw new NotFoundException('Discount not found');
      }
      if (error instanceof Error && error.message.includes('already exists')) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof Error && error.message.includes('must be')) {
        throw new BadRequestException(error.message);
      }
      this.controllerHelper.handleError(
        'updateDiscount',
        error,
        { user },
        startTime,
        { discountId: id },
      );
    }
  }

  /**
   * Delete discount
   * DELETE /admin/discounts/:id
   */
  @Delete(':id')
  async deleteDiscount(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    const startTime = Date.now();
    this.controllerHelper.logRequestStart(
      'deleteDiscount',
      { user },
      { discountId: id },
    );

    try {
      const { code } = await this.adminDiscountService.deleteDiscount(id);
      this.controllerHelper.logRequestSuccess(
        'deleteDiscount',
        { user },
        startTime,
        {
          discountId: id,
          code,
        },
      );
      return { success: true, message: 'Discount deleted successfully' };
    } catch (error) {
      if (error instanceof Error && error.message === 'Discount not found') {
        throw new NotFoundException('Discount not found');
      }
      this.controllerHelper.handleError(
        'deleteDiscount',
        error,
        { user },
        startTime,
        { discountId: id },
      );
    }
  }

  /**
   * Bulk activate discounts
   * POST /admin/discounts/bulk-activate
   */
  @Post('bulk-activate')
  async bulkActivate(
    @CurrentUser() user: { id: string },
    @Body() body: BulkDiscountIdsDto,
  ) {
    const startTime = Date.now();
    this.controllerHelper.logRequestStart(
      'bulkActivate',
      { user },
      { idsCount: body.ids?.length },
    );

    try {
      const { modifiedCount } = await this.adminDiscountService.bulkActivate(
        body.ids,
      );
      this.controllerHelper.logRequestSuccess(
        'bulkActivate',
        { user },
        startTime,
        { modifiedCount },
      );
      return {
        success: true,
        message: `${modifiedCount} discount(s) activated successfully`,
        data: { modifiedCount },
      };
    } catch (error) {
      this.controllerHelper.handleError(
        'bulkActivate',
        error,
        { user },
        startTime,
      );
    }
  }

  /**
   * Bulk deactivate discounts
   * POST /admin/discounts/bulk-deactivate
   */
  @Post('bulk-deactivate')
  async bulkDeactivate(
    @CurrentUser() user: { id: string },
    @Body() body: BulkDiscountIdsDto,
  ) {
    const startTime = Date.now();
    this.controllerHelper.logRequestStart(
      'bulkDeactivate',
      { user },
      { idsCount: body.ids?.length },
    );

    try {
      const { modifiedCount } = await this.adminDiscountService.bulkDeactivate(
        body.ids,
      );
      this.controllerHelper.logRequestSuccess(
        'bulkDeactivate',
        { user },
        startTime,
        { modifiedCount },
      );
      return {
        success: true,
        message: `${modifiedCount} discount(s) deactivated successfully`,
        data: { modifiedCount },
      };
    } catch (error) {
      this.controllerHelper.handleError(
        'bulkDeactivate',
        error,
        { user },
        startTime,
      );
    }
  }

  /**
   * Bulk delete discounts
   * POST /admin/discounts/bulk-delete
   */
  @Post('bulk-delete')
  async bulkDelete(
    @CurrentUser() user: { id: string },
    @Body() body: BulkDiscountIdsDto,
  ) {
    const startTime = Date.now();
    this.controllerHelper.logRequestStart(
      'bulkDelete',
      { user },
      { idsCount: body.ids?.length },
    );

    try {
      const { deletedCount } = await this.adminDiscountService.bulkDelete(
        body.ids,
      );
      this.controllerHelper.logRequestSuccess(
        'bulkDelete',
        { user },
        startTime,
        { deletedCount },
      );
      return {
        success: true,
        message: `${deletedCount} discount(s) deleted successfully`,
        data: { deletedCount },
      };
    } catch (error) {
      this.controllerHelper.handleError(
        'bulkDelete',
        error,
        { user },
        startTime,
      );
    }
  }
}
