import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Header,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BusinessEventLoggingService } from '../../common/services/business-event-logging.service';
import { KeyVaultService } from './key-vault.service';
import {
  CreateProviderKeyDto,
  CreateProxyKeyDto,
  UpdateProxyKeyStatusDto,
} from './dto';

@Controller('api/key-vault')
@UseGuards(JwtAuthGuard)
export class KeyVaultController {
  constructor(
    private readonly keyVaultService: KeyVaultService,
    private readonly businessEventLoggingService: BusinessEventLoggingService,
  ) {}

  /**
   * GET /api/key-vault/dashboard
   * Dashboard overview of all keys and analytics
   */
  @Get('dashboard')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  @Header('Expires', '0')
  async getDashboard(@CurrentUser('id') userId: string) {
    const startTime = Date.now();
    const dashboardData = await this.keyVaultService.getDashboardData(userId);

    this.businessEventLoggingService.logBusiness({
      event: 'key_vault_dashboard_retrieved',
      category: 'key_vault_operations',
      value: Date.now() - startTime,
      metadata: {
        userId,
        providerKeysCount: dashboardData.providerKeys.length,
        proxyKeysCount: dashboardData.proxyKeys.length,
        hasProviderKeys: dashboardData.providerKeys.length > 0,
        hasProxyKeys: dashboardData.proxyKeys.length > 0,
        hasAnalytics: !!dashboardData.analytics,
      },
    });

    return {
      success: true,
      data: dashboardData,
    };
  }

  /**
   * POST /api/key-vault/provider-keys
   * Create a new provider key
   */
  @Post('provider-keys')
  @HttpCode(HttpStatus.CREATED)
  async createProviderKey(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateProviderKeyDto,
  ) {
    const startTime = Date.now();
    const providerKey = await this.keyVaultService.createProviderKey(userId, {
      name: dto.name,
      provider: dto.provider,
      apiKey: dto.apiKey,
      description: dto.description,
    });

    this.businessEventLoggingService.logBusiness({
      event: 'provider_key_created',
      category: 'key_vault_operations',
      value: Date.now() - startTime,
      metadata: {
        userId,
        providerKeyName: dto.name,
        provider: dto.provider,
        providerKeyId: (providerKey as any)._id,
        hasDescription: !!dto.description,
        isActive: providerKey.isActive,
      },
    });

    return {
      success: true,
      message: 'Provider key created successfully',
      data: {
        _id: (providerKey as any)._id,
        name: providerKey.name,
        provider: providerKey.provider,
        maskedKey: providerKey.maskedKey,
        description: providerKey.description,
        isActive: providerKey.isActive,
        createdAt: (providerKey as any).createdAt,
        lastUsed: providerKey.lastUsed,
      },
    };
  }

  /**
   * GET /api/key-vault/provider-keys
   * Get all provider keys for the authenticated user
   */
  @Get('provider-keys')
  @HttpCode(HttpStatus.OK)
  async getProviderKeys(@CurrentUser('id') userId: string) {
    const startTime = Date.now();
    const providerKeys = await this.keyVaultService.getProviderKeys(userId);

    this.businessEventLoggingService.logBusiness({
      event: 'provider_keys_retrieved',
      category: 'key_vault_operations',
      value: Date.now() - startTime,
      metadata: {
        userId,
        providerKeysCount: providerKeys.length,
        hasProviderKeys: providerKeys.length > 0,
      },
    });

    const response = providerKeys.map((key) => ({
      _id: (key as any)._id,
      name: key.name,
      provider: key.provider,
      maskedKey: key.maskedKey,
      description: key.description,
      isActive: key.isActive,
      createdAt: (key as any).createdAt,
      lastUsed: key.lastUsed,
    }));

    return {
      success: true,
      data: response,
    };
  }

  /**
   * DELETE /api/key-vault/provider-keys/:providerKeyId
   */
  @Delete('provider-keys/:providerKeyId')
  @HttpCode(HttpStatus.OK)
  async deleteProviderKey(
    @CurrentUser('id') userId: string,
    @Param('providerKeyId') providerKeyId: string,
  ) {
    const startTime = Date.now();
    await this.keyVaultService.deleteProviderKey(userId, providerKeyId);

    this.businessEventLoggingService.logBusiness({
      event: 'provider_key_deleted',
      category: 'key_vault_operations',
      value: Date.now() - startTime,
      metadata: { userId, providerKeyId },
    });

    return {
      success: true,
      message: 'Provider key deleted successfully',
    };
  }

  /**
   * POST /api/key-vault/proxy-keys
   * Create a new proxy key
   */
  @Post('proxy-keys')
  @HttpCode(HttpStatus.CREATED)
  async createProxyKey(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateProxyKeyDto,
  ) {
    const startTime = Date.now();
    const expiresAt = dto.expiresAt
      ? new Date(dto.expiresAt)
      : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    const proxyKey = await this.keyVaultService.createProxyKey(userId, {
      name: dto.name,
      providerKeyId: dto.providerKeyId,
      description: dto.description,
      projectId: dto.projectId,
      permissions: dto.permissions,
      budgetLimit: dto.budgetLimit,
      dailyBudgetLimit: dto.dailyBudgetLimit,
      monthlyBudgetLimit: dto.monthlyBudgetLimit,
      rateLimit: dto.rateLimit,
      allowedIPs: dto.allowedIPs,
      allowedDomains: dto.allowedDomains,
      expiresAt,
    });

    this.businessEventLoggingService.logBusiness({
      event: 'proxy_key_created',
      category: 'key_vault_operations',
      value: Date.now() - startTime,
      metadata: {
        userId,
        proxyKeyName: dto.name,
        providerKeyId: dto.providerKeyId,
        proxyKeyId: (proxyKey as any)._id,
        hasDescription: !!dto.description,
        hasProjectId: !!dto.projectId,
        hasPermissions: !!dto.permissions?.length,
        hasBudgetLimits: !!(
          dto.budgetLimit ??
          dto.dailyBudgetLimit ??
          dto.monthlyBudgetLimit
        ),
        hasRateLimit: !!dto.rateLimit,
        hasAllowedIPs: !!dto.allowedIPs?.length,
        hasAllowedDomains: !!dto.allowedDomains?.length,
        hasExpiresAt: !!dto.expiresAt,
        isActive: proxyKey.isActive,
      },
    });

    return {
      success: true,
      message: 'Proxy key created successfully',
      data: {
        _id: (proxyKey as any)._id,
        keyId: proxyKey.keyId,
        name: proxyKey.name,
        description: proxyKey.description,
        providerKeyId: proxyKey.providerKeyId,
        projectId: proxyKey.projectId,
        permissions: proxyKey.permissions,
        budgetLimit: proxyKey.budgetLimit,
        dailyBudgetLimit: proxyKey.dailyBudgetLimit,
        monthlyBudgetLimit: proxyKey.monthlyBudgetLimit,
        rateLimit: proxyKey.rateLimit,
        allowedIPs: proxyKey.allowedIPs,
        allowedDomains: proxyKey.allowedDomains,
        isActive: proxyKey.isActive,
        createdAt: (proxyKey as any).createdAt,
        expiresAt: proxyKey.expiresAt,
        usageStats: proxyKey.usageStats,
      },
    };
  }

  /**
   * GET /api/key-vault/proxy-keys
   * Get all proxy keys, optionally filtered by projectId
   */
  @Get('proxy-keys')
  @HttpCode(HttpStatus.OK)
  async getProxyKeys(
    @CurrentUser('id') userId: string,
    @Query('projectId') projectId?: string,
  ) {
    const startTime = Date.now();
    const proxyKeys = await this.keyVaultService.getProxyKeys(
      userId,
      projectId,
    );

    this.businessEventLoggingService.logBusiness({
      event: 'proxy_keys_retrieved',
      category: 'key_vault_operations',
      value: Date.now() - startTime,
      metadata: {
        userId,
        projectId,
        hasProjectId: !!projectId,
        proxyKeysCount: proxyKeys.length,
        hasProxyKeys: proxyKeys.length > 0,
      },
    });

    return {
      success: true,
      data: proxyKeys,
    };
  }

  /**
   * DELETE /api/key-vault/proxy-keys/:proxyKeyId
   */
  @Delete('proxy-keys/:proxyKeyId')
  @HttpCode(HttpStatus.OK)
  async deleteProxyKey(
    @CurrentUser('id') userId: string,
    @Param('proxyKeyId') proxyKeyId: string,
  ) {
    const startTime = Date.now();
    await this.keyVaultService.deleteProxyKey(userId, proxyKeyId);

    this.businessEventLoggingService.logBusiness({
      event: 'proxy_key_deleted',
      category: 'key_vault_operations',
      value: Date.now() - startTime,
      metadata: { userId, proxyKeyId },
    });

    return {
      success: true,
      message: 'Proxy key deleted successfully',
    };
  }

  /**
   * PATCH /api/key-vault/proxy-keys/:proxyKeyId/status
   */
  @Patch('proxy-keys/:proxyKeyId/status')
  @HttpCode(HttpStatus.OK)
  async updateProxyKeyStatus(
    @CurrentUser('id') userId: string,
    @Param('proxyKeyId') proxyKeyId: string,
    @Body() dto: UpdateProxyKeyStatusDto,
  ) {
    const startTime = Date.now();
    const updated = await this.keyVaultService.toggleProxyKey(
      userId,
      proxyKeyId,
      dto.isActive,
    );

    this.businessEventLoggingService.logBusiness({
      event: 'proxy_key_status_updated',
      category: 'key_vault_operations',
      value: Date.now() - startTime,
      metadata: {
        userId,
        proxyKeyId,
        isActive: dto.isActive,
        hasUpdatedProxyKey: !!updated,
      },
    });

    return {
      success: true,
      message: `Proxy key ${dto.isActive ? 'activated' : 'deactivated'} successfully`,
      data: updated,
    };
  }

  /**
   * GET /api/key-vault/analytics
   * Get proxy key analytics, optionally for a single proxyKeyId
   */
  @Get('analytics')
  @HttpCode(HttpStatus.OK)
  async getProxyKeyAnalytics(
    @CurrentUser('id') userId: string,
    @Query('proxyKeyId') proxyKeyId?: string,
  ) {
    const startTime = Date.now();
    const analytics = await this.keyVaultService.getProxyKeyAnalytics(
      userId,
      proxyKeyId,
    );

    this.businessEventLoggingService.logBusiness({
      event: 'proxy_key_analytics_retrieved',
      category: 'key_vault_operations',
      value: Date.now() - startTime,
      metadata: {
        userId,
        proxyKeyId,
        hasProxyKeyId: !!proxyKeyId,
        hasAnalytics: !!analytics,
      },
    });

    return {
      success: true,
      data: analytics,
    };
  }
}
