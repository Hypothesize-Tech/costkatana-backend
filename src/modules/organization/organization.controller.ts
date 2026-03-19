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
  UsePipes,
  ValidationPipe,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { OrganizationService } from './organization.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('api/organizations')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}

  @Get()
  async list(
    @CurrentUser('id') userId: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    const result = await this.organizationService.list(
      userId,
      limit ?? 50,
      offset ?? 0,
    );
    return {
      success: true,
      data: result.organizations,
      pagination: {
        total: result.total,
        limit: limit ?? 50,
        offset: offset ?? 0,
      },
    };
  }

  @Post()
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateOrganizationDto,
  ) {
    const organization = await this.organizationService.create(userId, dto);
    return {
      success: true,
      data: organization,
    };
  }

  @Get(':id')
  async getOne(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    const organization = await this.organizationService.getOrganizationById(id);
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }
    if (organization.ownerId !== userId) {
      throw new ForbiddenException('Access denied to this organization');
    }
    return {
      success: true,
      data: organization,
    };
  }

  @Put(':id')
  async update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationDto,
  ) {
    const organization = await this.organizationService.update(id, userId, dto);
    return {
      success: true,
      data: organization,
    };
  }

  @Delete(':id')
  async delete(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    await this.organizationService.delete(id, userId);
    return {
      success: true,
      message: 'Organization deactivated successfully',
    };
  }
}
