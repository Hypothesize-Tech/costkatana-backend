import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserTelemetryConfigService } from './services/user-telemetry-config.service';
import { CreateTelemetryConfigDto } from './dto/create-telemetry-config.dto';
import { UpdateTelemetryConfigDto } from './dto/update-telemetry-config.dto';
import { TestTelemetryEndpointDto } from './dto/test-telemetry-endpoint.dto';

@Controller('api/telemetry-config')
@UseGuards(JwtAuthGuard)
export class UserTelemetryConfigController {
  constructor(
    private readonly userTelemetryConfigService: UserTelemetryConfigService,
  ) {}

  /**
   * @route   GET /api/telemetry-config
   * @desc    Get all telemetry configurations for the authenticated user
   * @access  Private
   */
  @Get()
  async getUserTelemetryConfigs(@CurrentUser('id') userId: string) {
    try {
      const configs =
        await this.userTelemetryConfigService.getUserTelemetryConfigs(userId);

      return {
        success: true,
        data: configs,
      };
    } catch (error: any) {
      throw new HttpException(
        {
          success: false,
          message: 'Failed to get telemetry configurations',
          error: error.message || 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * @route   GET /api/telemetry-config/:configId
   * @desc    Get a specific telemetry configuration
   * @access  Private
   */
  @Get(':configId')
  async getTelemetryConfig(
    @CurrentUser('id') userId: string,
    @Param('configId') configId: string,
  ) {
    try {
      const config = await this.userTelemetryConfigService.getTelemetryConfig(
        userId,
        configId,
      );

      return {
        success: true,
        data: config,
      };
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          success: false,
          message: 'Failed to get telemetry configuration',
          error: error.message || 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * @route   POST /api/telemetry-config/test
   * @desc    Test connectivity to a telemetry endpoint
   * @access  Private
   * @body    { endpointType, endpoint, authToken? }
   */
  @Post('test')
  async testTelemetryEndpoint(@Body() dto: TestTelemetryEndpointDto) {
    try {
      const result =
        await this.userTelemetryConfigService.testTelemetryEndpoint(dto);

      return {
        success: true,
        data: result,
      };
    } catch (error: any) {
      throw new HttpException(
        {
          success: false,
          message: 'Failed to test telemetry endpoint',
          error: error.message || 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * @route   POST /api/telemetry-config
   * @desc    Create a new telemetry configuration
   * @access  Private
   * @body    { endpointType, endpoint, authType?, authToken?, syncIntervalMinutes?, queryTimeRangeMinutes?, queryFilters? }
   */
  @Post()
  async createTelemetryConfig(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateTelemetryConfigDto,
  ) {
    try {
      const config =
        await this.userTelemetryConfigService.createTelemetryConfig(
          userId,
          dto,
        );

      return {
        success: true,
        message: 'Telemetry configuration created successfully',
        data: config,
      };
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          success: false,
          message: 'Failed to create telemetry configuration',
          error: error.message || 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * @route   PUT /api/telemetry-config/:configId
   * @desc    Update a telemetry configuration
   * @access  Private
   * @body    { endpoint?, authToken?, syncIntervalMinutes?, isActive?, syncEnabled? }
   */
  @Put(':configId')
  async updateTelemetryConfig(
    @CurrentUser('id') userId: string,
    @Param('configId') configId: string,
    @Body() dto: UpdateTelemetryConfigDto,
  ) {
    try {
      const config =
        await this.userTelemetryConfigService.updateTelemetryConfig(
          userId,
          configId,
          dto,
        );

      return {
        success: true,
        message: 'Configuration updated successfully',
        data: config,
      };
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          success: false,
          message: 'Failed to update telemetry configuration',
          error: error.message || 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * @route   DELETE /api/telemetry-config/:configId
   * @desc    Delete a telemetry configuration (soft delete)
   * @access  Private
   */
  @Delete(':configId')
  async deleteTelemetryConfig(
    @CurrentUser('id') userId: string,
    @Param('configId') configId: string,
  ) {
    try {
      await this.userTelemetryConfigService.deleteTelemetryConfig(
        userId,
        configId,
      );

      return {
        success: true,
        message: 'Configuration deleted successfully',
      };
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          success: false,
          message: 'Failed to delete telemetry configuration',
          error: error.message || 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * @route   POST /api/telemetry-config/:configId/sync
   * @desc    Trigger a manual sync for a specific configuration
   * @access  Private
   */
  @Post(':configId/sync')
  async triggerManualSync(
    @CurrentUser('id') userId: string,
    @Param('configId') configId: string,
  ) {
    try {
      const result = await this.userTelemetryConfigService.triggerManualSync(
        userId,
        configId,
      );

      return {
        success: true,
        message: 'Manual sync completed',
        data: result.data,
      };
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          success: false,
          message: 'Failed to trigger manual sync',
          error: error.message || 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
