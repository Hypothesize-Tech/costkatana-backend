import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Header,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { LoggerService } from '../../common/logger/logger.service';

// Import all services
import { TenantIsolationService } from './services/tenant-isolation.service';
import { ExternalIdService } from './services/external-id.service';
import {
  KillSwitchService,
  KillSwitchReason,
} from './services/kill-switch.service';
import { InternalAccessControlService } from './services/internal-access-control.service';
import { AuditLoggerService } from './services/audit-logger.service';
import { AuditAnchorService } from './services/audit-anchor.service';
import { PermissionValidatorService } from './services/permission-validator.service';
import { DslParserService } from './services/dsl-parser.service';
import { IntentParserService } from './services/intent-parser.service';
import { PlanGeneratorService } from './services/plan-generator.service';
import { ExecutionEngineService } from './services/execution-engine.service';
import { SimulationEngineService } from './services/simulation-engine.service';
import { CostAnomalyGuardService } from './services/cost-anomaly-guard.service';
import { ResourceCreationPlanGeneratorService } from './services/resource-creation-plan-generator.service';
import { DefaultResourceConfigService } from './services/default-resource-config.service';
import { Ec2Service } from './services/ec2.service';
import { S3Service } from './services/s3.service';
import { RdsService } from './services/rds.service';
import { LambdaService } from './services/lambda.service';
import { CostExplorerService } from './services/cost-explorer.service';
import { CloudWatchService } from './services/cloudwatch.service';
import { DynamoDbService } from './services/dynamodb.service';
import { EcsService } from './services/ecs.service';
import { AwsChatHandlerService } from './services/aws-chat-handler.service';

// Import DTOs
import { CreateConnectionDto } from './dto/create-connection.dto';
import { ParseIntentDto } from './dto/parse-intent.dto';
import { GeneratePlanDto } from './dto/generate-plan.dto';
import { ApprovePlanDto } from './dto/approve-plan.dto';
import { ExecutePlanDto } from './dto/execute-plan.dto';
import { SimulatePlanDto } from './dto/simulate-plan.dto';
import { KillSwitchDto } from './dto/kill-switch.dto';
import { ValidateActionDto } from './dto/validate-action.dto';
import { StopStartInstancesDto } from './dto/stop-start-instances.dto';

// Import Schemas
import {
  AWSConnection,
  AWSConnectionDocument,
} from '@/schemas/integration/aws-connection.schema';

// Import Types
import { ExecutionPlan } from './types/aws-dsl.types';

@Controller('api/aws')
@UseGuards(JwtAuthGuard)
export class AwsController {
  constructor(
    @InjectModel(AWSConnection.name)
    private readonly awsConnectionModel: Model<AWSConnectionDocument>,
    private readonly logger: LoggerService,
    private readonly tenantIsolationService: TenantIsolationService,
    private readonly externalIdService: ExternalIdService,
    private readonly killSwitchService: KillSwitchService,
    private readonly internalAccessControlService: InternalAccessControlService,
    private readonly auditLoggerService: AuditLoggerService,
    private readonly auditAnchorService: AuditAnchorService,
    private readonly permissionValidatorService: PermissionValidatorService,
    private readonly dslParserService: DslParserService,
    private readonly intentParserService: IntentParserService,
    private readonly planGeneratorService: PlanGeneratorService,
    private readonly executionEngineService: ExecutionEngineService,
    private readonly simulationEngineService: SimulationEngineService,
    private readonly costAnomalyGuardService: CostAnomalyGuardService,
    private readonly resourceCreationService: ResourceCreationPlanGeneratorService,
    private readonly defaultResourceConfigService: DefaultResourceConfigService,
    private readonly ec2Service: Ec2Service,
    private readonly s3Service: S3Service,
    private readonly rdsService: RdsService,
    private readonly lambdaService: LambdaService,
    private readonly costExplorerService: CostExplorerService,
    private readonly cloudWatchService: CloudWatchService,
    private readonly dynamoDbService: DynamoDbService,
    private readonly ecsService: EcsService,
    private readonly awsChatHandlerService: AwsChatHandlerService,
  ) {}

  // ============================================================================
  // Connection Management
  // ============================================================================

  @Post('connections')
  async createConnection(
    @CurrentUser() user: any,
    @Body() dto: CreateConnectionDto,
  ) {
    try {
      // Validate the role ARN format
      if (!dto.roleArn || !dto.roleArn.startsWith('arn:aws:iam::')) {
        throw new Error(
          'Invalid role ARN format. Must start with arn:aws:iam::',
        );
      }

      // Generate external ID for confused deputy prevention
      const externalIdResult =
        await this.externalIdService.generateUniqueExternalId(
          user.id,
          dto.environment,
        );

      // Create the connection
      const connection = new this.awsConnectionModel({
        userId: user.id,
        name: dto.connectionName,
        roleArn: dto.roleArn,
        encryptedExternalId: externalIdResult.externalIdEncrypted,
        externalIdHash: externalIdResult.externalIdHash,
        environment: dto.environment,
        permissionMode: dto.permissionMode,
        allowedServices: dto.selectedPermissions || [],
        status: 'pending_verification',
        allowedRegions: dto.allowedRegions || ['us-east-1'],
      });

      await connection.save();

      // Log the creation
      this.logger.log('AWS connection created', {
        component: 'AwsController',
        operation: 'createConnection',
        userId: user.id,
        connectionId: connection._id?.toString(),
      });

      // Return connection without sensitive data
      return {
        success: true,
        connection: {
          id: connection._id,
          name: connection.name,
          roleArn: connection.roleArn,
          environment: connection.environment,
          permissionMode: connection.permissionMode,
          allowedRegions: connection.allowedRegions,
          allowedServices: connection.allowedServices,
          status: connection.status,
          createdAt: connection.createdAt,
        },
      };
    } catch (error) {
      this.logger.error('Failed to create AWS connection', {
        component: 'AwsController',
        operation: 'createConnection',
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('connections')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @Header('Pragma', 'no-cache')
  async listConnections(@CurrentUser() user: any) {
    try {
      const connections = await this.awsConnectionModel
        .find({ userId: user.id })
        .select('-encryptedExternalId -externalIdHash')
        .exec();

      return {
        success: true,
        data: {
          connections: connections.map((conn) => ({
            id: conn._id,
            name: conn.name,
            roleArn: conn.roleArn,
            environment: conn.environment,
            permissionMode: conn.permissionMode,
            allowedRegions: conn.allowedRegions,
            allowedServices: conn.allowedServices,
            status: conn.status,
            executionMode: conn.executionMode,
            createdAt: conn.createdAt,
            updatedAt: conn.updatedAt,
          })),
        },
      };
    } catch (error) {
      this.logger.error('Failed to list AWS connections', {
        component: 'AwsController',
        operation: 'listConnections',
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Delete('connections/:id')
  async deleteConnection(
    @CurrentUser() user: any,
    @Param('id') connectionId: string,
  ) {
    try {
      // Verify ownership
      const connection = await this.awsConnectionModel.findOne({
        _id: new Types.ObjectId(connectionId),
        userId: user.id,
      });

      if (!connection) {
        throw new Error('Connection not found or access denied');
      }

      // Delete the connection
      await this.awsConnectionModel.deleteOne({
        _id: new Types.ObjectId(connectionId),
      });

      // Revoke external ID
      await this.externalIdService.rotateExternalId(
        new Types.ObjectId(connectionId),
        user.id,
      );

      this.logger.log('AWS connection deleted', {
        component: 'AwsController',
        operation: 'deleteConnection',
        userId: user.id,
        connectionId,
      });

      return {
        success: true,
        message: 'Connection deleted successfully',
      };
    } catch (error) {
      this.logger.error('Failed to delete AWS connection', {
        component: 'AwsController',
        operation: 'deleteConnection',
        userId: user.id,
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('connections/:id/test')
  async testConnection(
    @CurrentUser() user: any,
    @Param('id') connectionId: string,
  ) {
    try {
      // Get connection with ownership verification
      const connection = await this.awsConnectionModel.findOne({
        _id: new Types.ObjectId(connectionId),
        userId: user.id,
      });

      if (!connection) {
        throw new Error('Connection not found or access denied');
      }

      // Check if connection is active
      if (connection.status !== 'active') {
        throw new Error(
          `Connection test failed: status is ${connection.status}`,
        );
      }

      // Update last used timestamp
      connection.lastUsedAt = new Date();
      connection.status = 'active';
      await connection.save();

      this.logger.log('AWS connection tested successfully', {
        component: 'AwsController',
        operation: 'testConnection',
        userId: user.id,
        connectionId,
      });

      return {
        success: true,
        message: 'Connection test successful',
        testedAt: connection.lastUsedAt,
        status: connection.status,
      };
    } catch (error) {
      this.logger.error('AWS connection test failed', {
        component: 'AwsController',
        operation: 'testConnection',
        userId: user.id,
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('connections/:id/permissions')
  async getConnectionPermissions(
    @CurrentUser() user: any,
    @Param('id') connectionId: string,
  ) {
    try {
      // Get connection with ownership verification
      const connection = await this.awsConnectionModel.findOne({
        _id: new Types.ObjectId(connectionId),
        userId: user.id,
      });

      if (!connection) {
        throw new Error('Connection not found or access denied');
      }

      // Get effective permissions
      const permissions = connection.allowedServices;

      return {
        success: true,
        permissions: {
          allowedServices: permissions,
          permissionMode: connection.permissionMode,
          deniedActions: connection.deniedActions || [],
        },
      };
    } catch (error) {
      this.logger.error('Failed to get connection permissions', {
        component: 'AwsController',
        operation: 'getConnectionPermissions',
        userId: user.id,
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('connections/:id/validate-action')
  async validateAction(
    @CurrentUser() user: any,
    @Param('id') connectionId: string,
    @Body() dto: ValidateActionDto,
  ) {
    try {
      // Get connection with ownership verification
      const connection = await this.awsConnectionModel.findOne({
        _id: new Types.ObjectId(connectionId),
        userId: user.id,
      });

      if (!connection) {
        throw new Error('Connection not found or access denied');
      }

      const result = await this.permissionValidatorService.validateAction(
        new Types.ObjectId(connectionId),
        dto.action,
        dto.region,
      );

      return {
        success: true,
        allowed: result.allowed,
        reason: result.reason,
        action: dto.action,
        region: dto.region,
      };
    } catch (error) {
      this.logger.error('Failed to validate action', {
        component: 'AwsController',
        operation: 'validateAction',
        userId: user.id,
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ============================================================================
  // Resources - EC2
  // ============================================================================

  @Get('connections/:id/ec2/instances')
  async listEC2Instances(
    @CurrentUser() user: any,
    @Param('id') connectionId: string,
    @Query('region') region?: string,
    @Query('filters') filters?: string,
  ) {
    try {
      // Get connection with ownership verification
      const connection = await this.awsConnectionModel.findOne({
        _id: new Types.ObjectId(connectionId),
        userId: user.id,
      });

      if (!connection) {
        throw new Error('Connection not found or access denied');
      }

      // Parse filters if provided
      let parsedFilters: Array<{ Name: string; Values: string[] }> | undefined;
      if (filters) {
        try {
          parsedFilters = JSON.parse(filters);
        } catch {
          // Invalid filter format, ignore
        }
      }

      const instances = await this.ec2Service.listInstances(
        connection,
        parsedFilters,
        region,
      );

      return {
        success: true,
        instances,
        count: instances.length,
      };
    } catch (error) {
      this.logger.error('Failed to list EC2 instances', {
        component: 'AwsController',
        operation: 'listEC2Instances',
        userId: user.id,
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('connections/:id/ec2/stop')
  async stopEC2Instances(
    @CurrentUser() user: any,
    @Param('id') connectionId: string,
    @Body() dto: StopStartInstancesDto,
  ) {
    try {
      // Get connection with ownership verification
      const connection = await this.awsConnectionModel.findOne({
        _id: new Types.ObjectId(connectionId),
        userId: user.id,
      });

      if (!connection) {
        throw new Error('Connection not found or access denied');
      }

      const results = await this.ec2Service.stopInstances(
        connection,
        dto.instanceIds,
        dto.region,
      );

      // Audit log
      await this.auditLoggerService.logSuccess(
        'ec2_instances_stopped',
        {
          userId: new Types.ObjectId(user.id) as any,
          connectionId: connection._id as any,
        },
        {
          service: 'ec2',
          operation: 'StopInstances',
          resources: dto.instanceIds,
        },
      );

      return {
        success: true,
        message: 'Instances stopped successfully',
        results,
      };
    } catch (error) {
      this.logger.error('Failed to stop EC2 instances', {
        component: 'AwsController',
        operation: 'stopEC2Instances',
        userId: user.id,
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('connections/:id/ec2/start')
  async startEC2Instances(
    @CurrentUser() user: any,
    @Param('id') connectionId: string,
    @Body() dto: StopStartInstancesDto,
  ) {
    try {
      // Get connection with ownership verification
      const connection = await this.awsConnectionModel.findOne({
        _id: new Types.ObjectId(connectionId),
        userId: user.id,
      });

      if (!connection) {
        throw new Error('Connection not found or access denied');
      }

      const results = await this.ec2Service.startInstances(
        connection,
        dto.instanceIds,
        dto.region,
      );

      // Audit log
      await this.auditLoggerService.logSuccess(
        'ec2_instances_started',
        {
          userId: new Types.ObjectId(user.id) as any,
          connectionId: connection._id as any,
        },
        {
          service: 'ec2',
          operation: 'StartInstances',
          resources: dto.instanceIds,
        },
      );

      return {
        success: true,
        message: 'Instances started successfully',
        results,
      };
    } catch (error) {
      this.logger.error('Failed to start EC2 instances', {
        component: 'AwsController',
        operation: 'startEC2Instances',
        userId: user.id,
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ============================================================================
  // Resources - S3
  // ============================================================================

  @Get('connections/:id/s3/buckets')
  async listS3Buckets(
    @CurrentUser() user: any,
    @Param('id') connectionId: string,
  ) {
    try {
      // Get connection with ownership verification
      const connection = await this.awsConnectionModel.findOne({
        _id: new Types.ObjectId(connectionId),
        userId: user.id,
      });

      if (!connection) {
        throw new Error('Connection not found or access denied');
      }

      const buckets = await this.s3Service.listBuckets(connection);

      return {
        success: true,
        buckets,
        count: buckets.length,
      };
    } catch (error) {
      this.logger.error('Failed to list S3 buckets', {
        component: 'AwsController',
        operation: 'listS3Buckets',
        userId: user.id,
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ============================================================================
  // Resources - RDS
  // ============================================================================

  @Get('connections/:id/rds/instances')
  async listRDSInstances(
    @CurrentUser() user: any,
    @Param('id') connectionId: string,
    @Query('region') region?: string,
  ) {
    try {
      // Get connection with ownership verification
      const connection = await this.awsConnectionModel.findOne({
        _id: new Types.ObjectId(connectionId),
        userId: user.id,
      });

      if (!connection) {
        throw new Error('Connection not found or access denied');
      }

      const instances = await this.rdsService.listInstances(connection, region);

      return {
        success: true,
        instances,
        count: instances.length,
      };
    } catch (error) {
      this.logger.error('Failed to list RDS instances', {
        component: 'AwsController',
        operation: 'listRDSInstances',
        userId: user.id,
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ============================================================================
  // Resources - Lambda
  // ============================================================================

  @Get('connections/:id/lambda/functions')
  async listLambdaFunctions(
    @CurrentUser() user: any,
    @Param('id') connectionId: string,
    @Query('region') region?: string,
  ) {
    try {
      // Get connection with ownership verification
      const connection = await this.awsConnectionModel.findOne({
        _id: new Types.ObjectId(connectionId),
        userId: user.id,
      });

      if (!connection) {
        throw new Error('Connection not found or access denied');
      }

      const functions = await this.lambdaService.listFunctions(
        connection,
        region,
      );

      return {
        success: true,
        functions,
        count: functions.length,
      };
    } catch (error) {
      this.logger.error('Failed to list Lambda functions', {
        component: 'AwsController',
        operation: 'listLambdaFunctions',
        userId: user.id,
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ============================================================================
  // Cost Explorer
  // ============================================================================

  @Get('connections/:id/costs')
  async getCosts(
    @CurrentUser() user: any,
    @Param('id') connectionId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    try {
      // Get connection with ownership verification
      const connection = await this.awsConnectionModel.findOne({
        _id: new Types.ObjectId(connectionId),
        userId: user.id,
      });

      if (!connection) {
        throw new Error('Connection not found or access denied');
      }

      // Default to last 30 days if dates not provided
      const end = endDate ? new Date(endDate) : new Date();
      const start = startDate
        ? new Date(startDate)
        : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

      const costs = await this.costExplorerService.getCostAndUsage(
        connection,
        start.toISOString().split('T')[0],
        end.toISOString().split('T')[0],
        'DAILY',
      );

      return {
        success: true,
        costs,
        period: { start, end },
      };
    } catch (error) {
      this.logger.error('Failed to get costs', {
        component: 'AwsController',
        operation: 'getCosts',
        userId: user.id,
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('connections/:id/costs/breakdown')
  async getCostBreakdown(
    @CurrentUser() user: any,
    @Param('id') connectionId: string,
  ) {
    try {
      // Get connection with ownership verification
      const connection = await this.awsConnectionModel.findOne({
        _id: new Types.ObjectId(connectionId),
        userId: user.id,
      });

      if (!connection) {
        throw new Error('Connection not found or access denied');
      }

      const breakdown =
        await this.costExplorerService.getCostBreakdownByService(
          connection,
          new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
            .toISOString()
            .split('T')[0],
          new Date().toISOString().split('T')[0],
        );

      return {
        success: true,
        breakdown,
      };
    } catch (error) {
      this.logger.error('Failed to get cost breakdown', {
        component: 'AwsController',
        operation: 'getCostBreakdown',
        userId: user.id,
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('connections/:id/costs/forecast')
  async getCostForecast(
    @CurrentUser() user: any,
    @Param('id') connectionId: string,
  ) {
    try {
      // Get connection with ownership verification
      const connection = await this.awsConnectionModel.findOne({
        _id: new Types.ObjectId(connectionId),
        userId: user.id,
      });

      if (!connection) {
        throw new Error('Connection not found or access denied');
      }

      const forecast = await this.costExplorerService.getCostForecast(
        connection,
        new Date().toISOString().split('T')[0],
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split('T')[0],
      );

      return {
        success: true,
        forecast,
      };
    } catch (error) {
      this.logger.error('Failed to get cost forecast', {
        component: 'AwsController',
        operation: 'getCostForecast',
        userId: user.id,
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('connections/:id/costs/anomalies')
  async getCostAnomalies(
    @CurrentUser() user: any,
    @Param('id') connectionId: string,
  ) {
    try {
      // Get connection with ownership verification
      const connection = await this.awsConnectionModel.findOne({
        _id: new Types.ObjectId(connectionId),
        userId: user.id,
      });

      if (!connection) {
        throw new Error('Connection not found or access denied');
      }

      const anomalies = await this.costExplorerService.getAnomalies(connection);

      return {
        success: true,
        anomalies,
      };
    } catch (error) {
      this.logger.error('Failed to get cost anomalies', {
        component: 'AwsController',
        operation: 'getCostAnomalies',
        userId: user.id,
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('connections/:id/costs/optimize')
  async getOptimizationRecommendations(
    @CurrentUser() user: any,
    @Param('id') connectionId: string,
  ) {
    try {
      // Get connection with ownership verification
      const connection = await this.awsConnectionModel.findOne({
        _id: new Types.ObjectId(connectionId),
        userId: user.id,
      });

      if (!connection) {
        throw new Error('Connection not found or access denied');
      }

      const recommendations =
        await this.costExplorerService.getOptimizationInsights(connection);

      return {
        success: true,
        recommendations,
      };
    } catch (error) {
      this.logger.error('Failed to get optimization recommendations', {
        component: 'AwsController',
        operation: 'getOptimizationRecommendations',
        userId: user.id,
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ============================================================================
  // Intent and Plan
  // ============================================================================

  @Post('intent')
  async parseIntent(@CurrentUser() user: any, @Body() dto: ParseIntentDto) {
    try {
      const intent = await this.intentParserService.parseIntent(dto.request);

      return {
        success: true,
        intent,
      };
    } catch (error) {
      this.logger.error('Failed to parse intent', {
        component: 'AwsController',
        operation: 'parseIntent',
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('plan')
  async generatePlan(@CurrentUser() user: any, @Body() dto: GeneratePlanDto) {
    try {
      const connection = await this.awsConnectionModel.findOne({
        _id: new Types.ObjectId(dto.connectionId),
        userId: user.id,
      });
      if (!connection) {
        throw new HttpException(
          { success: false, message: 'Connection not found or access denied' },
          HttpStatus.NOT_FOUND,
        );
      }
      // Parse the intent
      const intent = await this.intentParserService.parseIntent(dto.intent);

      // Generate plan from intent
      const plan = await this.planGeneratorService.generatePlan(
        intent,
        connection,
        dto.resources,
      );

      return {
        success: true,
        plan,
        requiresApproval: plan.summary?.requiresApproval ?? true,
        estimatedCost: plan.summary?.estimatedCostImpact ?? 0,
        estimatedTime: plan.summary?.estimatedDuration ?? 0,
      };
    } catch (error) {
      this.logger.error('Failed to generate plan', {
        component: 'AwsController',
        operation: 'generatePlan',
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ============================================================================
  // Execution
  // ============================================================================

  @Post('approve')
  async approvePlan(@CurrentUser() user: any, @Body() dto: ApprovePlanDto) {
    try {
      // Create operator object for internal access control
      const operator = {
        operatorId: user.id,
        email: user.email || 'unknown',
        role: 'viewer' as const,
        mfaEnabled: true,
      };

      // Request dual approval through internal access control
      const requestId =
        await this.internalAccessControlService.requestDualApproval(
          operator,
          'trigger_execution',
          `Plan approval requested for plan ${dto.planId}`,
          {
            planId: dto.planId,
            connectionId: dto.connectionId,
          },
        );

      return {
        success: true,
        message:
          'Plan approval requested successfully. Awaiting second approval.',
        requestedBy: user.id,
        requestedAt: new Date(),
        pendingApprovalId: requestId,
      };
    } catch (error) {
      this.logger.error('Failed to request plan approval', {
        component: 'AwsController',
        operation: 'approvePlan',
        userId: user.id,
        planId: dto.planId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('execute')
  async executePlan(@CurrentUser() user: any, @Body() dto: ExecutePlanDto) {
    try {
      // Get connection with ownership verification
      const connection = await this.awsConnectionModel.findOne({
        _id: new Types.ObjectId(dto.connectionId),
        userId: user.id,
      });

      if (!connection) {
        throw new Error('Connection not found or access denied');
      }

      // Check kill switch
      const killSwitchCheck = this.killSwitchService.checkKillSwitch({
        customerId: user.id,
        connectionId: dto.connectionId,
        service: (dto.plan as ExecutionPlan)?.steps?.[0]?.service || 'unknown',
        action: 'execute',
        isWrite: true,
        riskLevel: 'high',
      });

      if (!killSwitchCheck.allowed) {
        throw new Error(`Kill switch active: ${killSwitchCheck.reason}`);
      }

      // Execute the plan
      const result = await this.executionEngineService.execute(
        dto.plan as ExecutionPlan,
        connection,
        dto.approvalToken,
        user.id,
      );

      return {
        success: result.status === 'completed' || result.status === 'partial',
        message:
          result.status === 'completed' || result.status === 'partial'
            ? 'Plan executed successfully'
            : `Plan execution failed: ${result.error ?? result.status}`,
        executedSteps: result.executedSteps,
        failedSteps: result.failedSteps,
        totalDuration: result.duration,
        results: result.steps,
        error: result.error,
        rollbackPerformed: result.rollbackPerformed,
      };
    } catch (error) {
      this.logger.error('Failed to execute plan', {
        component: 'AwsController',
        operation: 'executePlan',
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('simulate')
  async simulatePlan(@CurrentUser() user: any, @Body() dto: SimulatePlanDto) {
    try {
      // Get connection with ownership verification
      const connection = await this.awsConnectionModel.findOne({
        _id: new Types.ObjectId(dto.connectionId),
        userId: user.id,
      });

      if (!connection) {
        throw new Error('Connection not found or access denied');
      }

      // Simulate the plan
      const result = await this.simulationEngineService.simulate(
        dto.plan as ExecutionPlan,
        dto.connectionId,
        user.id,
      );

      return {
        success: result.status === 'simulated',
        simulation: {
          planId: result.planId,
          simulatedAt: result.startedAt,
          success: result.status === 'simulated',
          estimatedCostImpact: result.costPrediction?.immediate ?? 0,
          estimatedDuration: result.duration,
          riskLevel: result.riskAssessment?.overallRisk ?? 'low',
          warnings: result.riskAssessment?.mitigations ?? [],
          permissionChecks: result.permissionValidation,
          resourceImpacts: result.costPrediction?.breakdown ?? [],
          error: result.status === 'failed' ? 'Simulation failed' : undefined,
        },
      };
    } catch (error) {
      this.logger.error('Failed to simulate plan', {
        component: 'AwsController',
        operation: 'simulatePlan',
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ============================================================================
  // Kill Switch
  // ============================================================================

  @Post('kill-switch')
  async activateKillSwitch(
    @CurrentUser() user: any,
    @Body() dto: KillSwitchDto,
  ) {
    try {
      // Validate reason is a valid KillSwitchReason
      const validReasons: KillSwitchReason[] = [
        'security_incident',
        'cost_anomaly',
        'manual_activation',
        'rate_limit_exceeded',
        'compliance_violation',
        'customer_request',
        'system_maintenance',
      ];

      if (!validReasons.includes(dto.reason as KillSwitchReason)) {
        throw new Error(`Invalid kill switch reason: ${dto.reason}`);
      }

      await this.killSwitchService.activateKillSwitch({
        scope: dto.scope,
        id: dto.id,
        reason: dto.reason as KillSwitchReason,
        activatedBy: user.id,
        notes: dto.notes,
      });

      // Audit log
      await this.auditLoggerService.logSuccess(
        'kill_switch_activated',
        {
          userId: new Types.ObjectId(user.id) as any,
        },
        {
          service: 'system',
          operation: 'ActivateKillSwitch',
        },
      );

      return {
        success: true,
        message: 'Kill switch activated',
        scope: dto.scope,
        id: dto.id,
        reason: dto.reason,
      };
    } catch (error) {
      this.logger.error('Failed to activate kill switch', {
        component: 'AwsController',
        operation: 'activateKillSwitch',
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('kill-switch')
  async getKillSwitchState(@CurrentUser() user: any) {
    try {
      const state = this.killSwitchService.getState();

      return {
        success: true,
        state,
      };
    } catch (error) {
      this.logger.error('Failed to get kill switch state', {
        component: 'AwsController',
        operation: 'getKillSwitchState',
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ============================================================================
  // Audit
  // ============================================================================

  @Get('audit')
  async getAuditLogs(
    @CurrentUser() user: any,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    try {
      const logs = await this.auditLoggerService.query({
        userId: new Types.ObjectId(user.id),
        limit: limit || 50,
        offset: offset || 0,
      });

      return {
        success: true,
        logs,
        count: logs.length,
      };
    } catch (error) {
      this.logger.error('Failed to get audit logs', {
        component: 'AwsController',
        operation: 'getAuditLogs',
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('audit/anchor')
  async getAuditAnchor(@CurrentUser() user: any) {
    try {
      const anchorData = await this.auditAnchorService.getPublicAnchorData();

      return {
        success: true,
        anchor: anchorData,
      };
    } catch (error) {
      this.logger.error('Failed to get audit anchor', {
        component: 'AwsController',
        operation: 'getAuditAnchor',
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('audit/verify')
  async verifyAuditChain(@CurrentUser() user: any) {
    try {
      const result = await this.auditAnchorService.verifyAnchorChain();

      return {
        success: true,
        verification: result,
      };
    } catch (error) {
      this.logger.error('Failed to verify audit chain', {
        component: 'AwsController',
        operation: 'verifyAuditChain',
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  @Get('actions')
  async getAllowedActions(@CurrentUser() user: any) {
    try {
      const actions = this.intentParserService.getAvailableActions();

      return {
        success: true,
        actions,
      };
    } catch (error) {
      this.logger.error('Failed to get allowed actions', {
        component: 'AwsController',
        operation: 'getAllowedActions',
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('boundaries')
  async getPermissionBoundaries(@CurrentUser() user: any) {
    try {
      // Get default permission boundaries
      const boundaries = {
        hardLimits: {
          maxEC2Instances: 100,
          maxRDSInstances: 50,
          maxLambdaMemory: 10240,
          maxS3Buckets: 100,
        },
        bannedActions: [
          'iam:CreateUser',
          'iam:DeleteAccount',
          'organizations:LeaveOrganization',
        ],
        requireApproval: [
          'ec2:TerminateInstances',
          'rds:DeleteDBInstance',
          's3:DeleteBucket',
        ],
      };

      return {
        success: true,
        boundaries,
      };
    } catch (error) {
      this.logger.error('Failed to get permission boundaries', {
        component: 'AwsController',
        operation: 'getPermissionBoundaries',
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('emergency-stop/:connectionId')
  async getEmergencyStopInstructions(
    @CurrentUser() user: any,
    @Param('connectionId') connectionId: string,
  ) {
    try {
      // Get connection with ownership verification
      const connection = await this.awsConnectionModel.findOne({
        _id: new Types.ObjectId(connectionId),
        userId: user.id,
      });

      if (!connection) {
        throw new Error('Connection not found or access denied');
      }

      const instructions = this.killSwitchService.getEmergencyStopInstructions(
        connection.roleArn,
      );

      return {
        success: true,
        instructions,
      };
    } catch (error) {
      this.logger.error('Failed to get emergency stop instructions', {
        component: 'AwsController',
        operation: 'getEmergencyStopInstructions',
        userId: user.id,
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpException(
        { success: false, message: error.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
