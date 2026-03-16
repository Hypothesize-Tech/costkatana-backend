import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import axios from 'axios';
import { LoggerService } from '../../../common/logger/logger.service';
import {
  UserTelemetryConfig,
  UserTelemetryConfigDocument,
} from '../../../schemas/integration/user-telemetry-config.schema';
import { CreateTelemetryConfigDto } from '../dto/create-telemetry-config.dto';
import { UpdateTelemetryConfigDto } from '../dto/update-telemetry-config.dto';
import { TestTelemetryEndpointDto } from '../dto/test-telemetry-endpoint.dto';
import { TelemetryPollerService } from './telemetry-poller.service';

@Injectable()
export class UserTelemetryConfigService {
  constructor(
    @InjectModel(UserTelemetryConfig.name)
    private userTelemetryConfigModel: Model<UserTelemetryConfigDocument>,
    private logger: LoggerService,
    private telemetryPollerService: TelemetryPollerService,
  ) {}

  /**
   * Get all telemetry configurations for a user
   */
  async getUserTelemetryConfigs(
    userId: string,
  ): Promise<UserTelemetryConfigDocument[]> {
    this.logger.info('Getting user telemetry configs', { userId });

    const configs = await this.userTelemetryConfigModel
      .find({ userId, isActive: true })
      .select('-authToken -username -password') // Exclude sensitive fields
      .sort({ createdAt: -1 });

    this.logger.info('Retrieved user telemetry configs', {
      userId,
      count: configs.length,
    });

    return configs;
  }

  /**
   * Get a single telemetry configuration
   */
  async getTelemetryConfig(
    userId: string,
    configId: string,
  ): Promise<UserTelemetryConfigDocument> {
    this.logger.info('Getting telemetry config', { userId, configId });

    // Validate ObjectId format
    if (!this.isValidObjectId(configId)) {
      throw new BadRequestException('Invalid config ID format');
    }

    const config = await this.userTelemetryConfigModel.findOne({
      _id: configId,
      userId,
    });

    if (!config) {
      throw new NotFoundException('Configuration not found');
    }

    // Mask sensitive fields in response
    const configObj = config.toObject();
    if (configObj.authToken) {
      configObj.authToken = '***' + configObj.authToken.slice(-4);
    }
    if (configObj.password) {
      configObj.password = '***' + configObj.password.slice(-4);
    }

    this.logger.info('Retrieved telemetry config', { userId, configId });

    return configObj as UserTelemetryConfigDocument;
  }

  /**
   * Create a new telemetry configuration
   */
  async createTelemetryConfig(
    userId: string,
    dto: CreateTelemetryConfigDto,
  ): Promise<UserTelemetryConfigDocument> {
    this.logger.info('Creating telemetry config', {
      userId,
      endpointType: dto.endpointType,
    });

    // Validate endpoint type
    const validTypes = [
      'otlp-http',
      'otlp-grpc',
      'tempo',
      'jaeger',
      'prometheus',
      'custom',
    ];
    if (!validTypes.includes(dto.endpointType)) {
      throw new BadRequestException(
        `Invalid endpointType. Must be one of: ${validTypes.join(', ')}`,
      );
    }

    // Check for duplicate endpoint
    const existingConfig = await this.userTelemetryConfigModel.findOne({
      userId,
      endpointType: dto.endpointType,
      endpoint: dto.endpoint,
      isActive: true,
    });

    if (existingConfig) {
      throw new ConflictException(
        'A configuration for this endpoint already exists',
      );
    }

    // Create new configuration
    const config = new this.userTelemetryConfigModel({
      userId,
      endpointType: dto.endpointType,
      endpoint: dto.endpoint,
      authType: dto.authType || 'none',
      authToken: dto.authToken || undefined,
      authHeader: dto.authHeader || undefined,
      username: dto.username || undefined,
      password: dto.password || undefined,
      syncIntervalMinutes: dto.syncIntervalMinutes || 5,
      queryTimeRangeMinutes: dto.queryTimeRangeMinutes || 10,
      queryFilters: dto.queryFilters || undefined,
      isActive: true,
      syncEnabled: true,
      useTLS: dto.endpoint.startsWith('https'),
      healthCheckEnabled: true,
    });

    const savedConfig = await config.save();

    // Mask auth token in response
    const responseData = savedConfig.toObject();
    if (responseData.authToken) {
      responseData.authToken = '***' + responseData.authToken.slice(-4);
    }
    if (responseData.password) {
      responseData.password = '***' + responseData.password.slice(-4);
    }

    this.logger.info('Created telemetry config', {
      userId,
      configId: savedConfig._id,
      endpointType: dto.endpointType,
    });

    return responseData as UserTelemetryConfigDocument;
  }

  /**
   * Update a telemetry configuration
   */
  async updateTelemetryConfig(
    userId: string,
    configId: string,
    dto: UpdateTelemetryConfigDto,
  ): Promise<UserTelemetryConfigDocument> {
    this.logger.info('Updating telemetry config', { userId, configId });

    // Validate ObjectId format
    if (!this.isValidObjectId(configId)) {
      throw new BadRequestException('Invalid config ID format');
    }

    const config = await this.userTelemetryConfigModel.findOne({
      _id: configId,
      userId,
    });

    if (!config) {
      throw new NotFoundException('Configuration not found');
    }

    // Update fields
    if (dto.endpoint !== undefined) config.endpoint = dto.endpoint;
    if (dto.authToken !== undefined) config.authToken = dto.authToken;
    if (dto.syncIntervalMinutes !== undefined)
      config.syncIntervalMinutes = dto.syncIntervalMinutes;
    if (dto.isActive !== undefined) config.isActive = dto.isActive;
    if (dto.syncEnabled !== undefined) config.syncEnabled = dto.syncEnabled;

    await config.save();

    // Mask auth token in response
    const responseData = config.toObject();
    if (responseData.authToken) {
      responseData.authToken = '***' + responseData.authToken.slice(-4);
    }
    if (responseData.password) {
      responseData.password = '***' + responseData.password.slice(-4);
    }

    this.logger.info('Updated telemetry config', { userId, configId });

    return responseData as UserTelemetryConfigDocument;
  }

  /**
   * Delete a telemetry configuration (soft delete)
   */
  async deleteTelemetryConfig(userId: string, configId: string): Promise<void> {
    this.logger.info('Deleting telemetry config', { userId, configId });

    // Validate ObjectId format
    if (!this.isValidObjectId(configId)) {
      throw new BadRequestException('Invalid config ID format');
    }

    const config = await this.userTelemetryConfigModel.findOne({
      _id: configId,
      userId,
    });

    if (!config) {
      throw new NotFoundException('Configuration not found');
    }

    // Soft delete
    config.isActive = false;
    await config.save();

    this.logger.info('Deleted telemetry config', { userId, configId });
  }

  /**
   * Test a telemetry endpoint connection
   */
  async testTelemetryEndpoint(dto: TestTelemetryEndpointDto): Promise<{
    reachable: boolean;
    statusCode?: number;
    responseTime?: number;
    error?: string;
    message: string;
  }> {
    this.logger.info('Testing telemetry endpoint', {
      endpointType: dto.endpointType,
    });

    try {
      const startTime = Date.now();

      // Basic connectivity test
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };

      if (dto.authToken) {
        headers['Authorization'] = `Bearer ${dto.authToken}`;
      }

      let testUrl = dto.endpoint;
      if (dto.endpointType === 'tempo') {
        testUrl = `${dto.endpoint}/api/search?limit=1`;
      } else if (dto.endpointType === 'jaeger') {
        testUrl = `${dto.endpoint}/api/services`;
      }

      const response = await axios.get(testUrl, {
        headers,
        timeout: 10000,
        validateStatus: () => true, // Accept any status for testing
      });

      const responseTime = Date.now() - startTime;
      const isSuccess = response.status >= 200 && response.status < 400;

      this.logger.info('Telemetry endpoint test completed', {
        endpointType: dto.endpointType,
        statusCode: response.status,
        success: isSuccess,
        responseTime,
      });

      return {
        reachable: isSuccess,
        statusCode: response.status,
        responseTime,
        message: isSuccess
          ? 'Endpoint is reachable and responding'
          : `Endpoint returned status ${response.status}`,
      };
    } catch (error: any) {
      this.logger.warn('Telemetry endpoint test failed', {
        endpointType: dto.endpointType,
        error: error.message,
      });

      return {
        reachable: false,
        error: error.message,
        message: 'Could not connect to endpoint',
      };
    }
  }

  /**
   * Trigger a manual sync for a specific configuration
   */
  async triggerManualSync(
    userId: string,
    configId: string,
  ): Promise<{
    success: boolean;
    message: string;
    data?: any;
  }> {
    this.logger.info('Triggering manual sync', { userId, configId });

    // Validate ObjectId format
    if (!this.isValidObjectId(configId)) {
      throw new BadRequestException('Invalid config ID format');
    }

    const config = await this.userTelemetryConfigModel.findOne({
      _id: configId,
      userId,
      isActive: true,
    });

    if (!config) {
      throw new NotFoundException('Configuration not found or inactive');
    }

    try {
      const result =
        await this.telemetryPollerService.pollSingleEndpoint(config);

      this.logger.info('Manual sync completed', {
        userId,
        configId,
        success: result.success,
      });

      return {
        success: result.success,
        message: result.success
          ? 'Manual sync completed'
          : 'Manual sync failed',
        data: result,
      };
    } catch (error: any) {
      this.logger.error('Manual sync failed', {
        userId,
        configId,
        error: error.message,
      });

      return {
        success: false,
        message: 'Manual sync failed',
        data: { error: error.message },
      };
    }
  }

  /**
   * Validate ObjectId format
   */
  private isValidObjectId(id: string): boolean {
    return /^[0-9a-fA-F]{24}$/.test(id);
  }
}
