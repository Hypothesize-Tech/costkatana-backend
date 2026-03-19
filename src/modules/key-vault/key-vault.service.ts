import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomBytes } from 'crypto';
import { ProxyKey } from '../../schemas/misc/proxy-key.schema';
import { ProviderKey } from '../../schemas/misc/provider-key.schema';
import { Project } from '../../schemas/team-project/project.schema';
import { encrypt, decrypt } from '../../utils/helpers';
import type { ProviderKeyProvider } from './dto/create-provider-key.dto';

export interface CreateProviderKeyRequest {
  name: string;
  provider: ProviderKeyProvider;
  apiKey: string;
  description?: string;
}

export interface CreateProxyKeyRequest {
  name: string;
  providerKeyId: string;
  description?: string;
  projectId?: string;
  teamId?: string;
  assignedProjects?: string[];
  scope?: 'personal' | 'team' | 'project' | 'organization';
  sharedWith?: string[];
  permissions?: ('read' | 'write' | 'admin')[];
  budgetLimit?: number;
  dailyBudgetLimit?: number;
  monthlyBudgetLimit?: number;
  rateLimit?: number;
  allowedIPs?: string[];
  allowedDomains?: string[];
  expiresAt?: Date;
}

let keyVaultServiceInstance: KeyVaultService | null = null;

export function getKeyVaultService(): KeyVaultService {
  if (!keyVaultServiceInstance) {
    throw new Error(
      'KeyVaultService not initialized. Ensure KeyVaultModule is imported.',
    );
  }
  return keyVaultServiceInstance;
}

@Injectable()
export class KeyVaultService {
  private readonly logger = new Logger(KeyVaultService.name);

  constructor(
    @InjectModel(ProxyKey.name) private proxyKeyModel: Model<ProxyKey>,
    @InjectModel(ProviderKey.name) private providerKeyModel: Model<ProviderKey>,
    @InjectModel(Project.name) private projectModel: Model<Project>,
    private readonly configService: ConfigService,
  ) {
    keyVaultServiceInstance = this;
  }

  /**
   * Create a new provider key in the vault
   */
  async createProviderKey(
    userId: string,
    request: CreateProviderKeyRequest,
  ): Promise<ProviderKey> {
    const existingKey = await this.providerKeyModel.findOne({
      userId: new Types.ObjectId(userId),
      provider: request.provider,
      name: request.name,
    });

    if (existingKey) {
      throw new BadRequestException(
        `Provider key with name "${request.name}" for ${request.provider} already exists`,
      );
    }

    const { encrypted, iv, authTag } = encrypt(
      request.apiKey,
      this.configService,
    );
    const encryptedKey = `${iv}:${authTag}:${encrypted}`;
    const maskedKey = this.maskApiKey(request.apiKey);

    const providerKey = await this.providerKeyModel.create({
      name: request.name,
      provider: request.provider,
      encryptedKey,
      maskedKey,
      userId: new Types.ObjectId(userId),
      description: request.description,
      isActive: true,
    });

    this.logger.log('Provider key created', {
      userId,
      provider: request.provider,
      name: request.name,
      keyId: (providerKey as any)._id,
    });

    return providerKey as ProviderKey;
  }

  /**
   * Create a new proxy key linked to a provider key
   */
  async createProxyKey(
    userId: string,
    request: CreateProxyKeyRequest,
  ): Promise<ProxyKey> {
    const keyId = this.generateProxyKeyId();

    await this.validateProviderKey(userId, request.providerKeyId);
    if (request.projectId) {
      await this.validateProject(userId, request.projectId);
    }

    const expiresAt =
      request.expiresAt ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    const proxyKey = await this.proxyKeyModel.create({
      keyId,
      name: request.name,
      description: request.description,
      providerKeyId: new Types.ObjectId(request.providerKeyId),
      userId: new Types.ObjectId(userId),
      projectId: request.projectId
        ? new Types.ObjectId(request.projectId)
        : undefined,
      permissions: request.permissions ?? ['read'],
      budgetLimit: request.budgetLimit,
      dailyBudgetLimit: request.dailyBudgetLimit,
      monthlyBudgetLimit: request.monthlyBudgetLimit,
      rateLimit: request.rateLimit,
      allowedIPs: request.allowedIPs,
      allowedDomains: request.allowedDomains,
      expiresAt,
      isActive: true,
      usageStats: {
        totalRequests: 0,
        totalCost: 0,
        lastResetDate: new Date(),
        dailyCost: 0,
        monthlyCost: 0,
      },
    });

    this.logger.log('Proxy key created', {
      userId,
      proxyKeyId: keyId,
      name: request.name,
      providerKeyId: request.providerKeyId,
    });

    return proxyKey as ProxyKey;
  }

  /**
   * Resolve a proxy key to get the actual API key and provider information
   */
  async resolveProxyKey(proxyKeyId: string): Promise<{
    proxyKey: ProxyKey;
    providerKey: ProviderKey;
    decryptedApiKey: string;
  } | null> {
    try {
      const proxyKey = await this.proxyKeyModel
        .findOne({ keyId: proxyKeyId, isActive: true })
        .populate('providerKeyId')
        .exec();

      if (!proxyKey) {
        this.logger.warn('Proxy key not found or inactive', { proxyKeyId });
        return null;
      }

      if (proxyKey.isExpired()) {
        this.logger.warn('Proxy key is expired', { proxyKeyId });
        return null;
      }

      if (proxyKey.isOverBudget()) {
        this.logger.warn('Proxy key is over budget', { proxyKeyId });
        return null;
      }

      const providerKey = await this.providerKeyModel.findById(
        proxyKey.providerKeyId,
      );
      if (!providerKey || !providerKey.isActive) {
        this.logger.warn('Provider key not found or inactive', {
          proxyKeyId,
          providerKeyId: proxyKey.providerKeyId,
        });
        return null;
      }

      const [iv, authTag, encrypted] = providerKey.encryptedKey.split(':');
      if (!iv || !authTag || !encrypted) {
        this.logger.error('Invalid encrypted key format', {
          proxyKeyId,
          providerKeyId: providerKey._id,
        });
        return null;
      }

      let decryptedApiKey: string;
      try {
        decryptedApiKey = decrypt(encrypted, iv, authTag, this.configService);
      } catch (error) {
        this.logger.error('Failed to decrypt API key', {
          proxyKeyId,
          providerKeyId: providerKey._id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return null;
      }

      const now = new Date();
      proxyKey.lastUsed = now;
      providerKey.lastUsed = now;
      await Promise.all([proxyKey.save(), providerKey.save()]);

      this.logger.debug('Proxy key resolved', {
        proxyKeyId,
        provider: providerKey.provider,
        userId: proxyKey.userId,
      });

      return { proxyKey, providerKey, decryptedApiKey };
    } catch (error) {
      this.logger.error('Error resolving proxy key', {
        proxyKeyId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Update proxy key usage with atomic pipeline (Express parity)
   */
  async updateProxyKeyUsage(
    proxyKeyId: string,
    cost: number,
    requests: number = 1,
  ): Promise<void> {
    try {
      const now = new Date();
      const startOfDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      );
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      await this.proxyKeyModel.updateOne({ keyId: proxyKeyId }, [
        {
          $set: {
            'usageStats.totalRequests': {
              $add: ['$usageStats.totalRequests', requests],
            },
            'usageStats.totalCost': { $add: ['$usageStats.totalCost', cost] },
            'usageStats.dailyCost': {
              $cond: [
                { $lt: ['$usageStats.lastResetDate', startOfDay] },
                cost,
                { $add: ['$usageStats.dailyCost', cost] },
              ],
            },
            'usageStats.monthlyCost': {
              $cond: [
                { $lt: ['$usageStats.lastResetDate', startOfMonth] },
                cost,
                { $add: ['$usageStats.monthlyCost', cost] },
              ],
            },
            'usageStats.lastResetDate': {
              $cond: [
                { $lt: ['$usageStats.lastResetDate', startOfDay] },
                startOfDay,
                '$usageStats.lastResetDate',
              ],
            },
            lastUsed: now,
          },
        },
      ]);
    } catch (error) {
      this.logger.error('Failed to update proxy key usage', {
        proxyKeyId,
        cost,
        requests,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Record usage for a proxy key (convenience wrapper)
   */
  async recordProxyKeyUsage(proxyKeyId: string, cost: number): Promise<void> {
    return this.updateProxyKeyUsage(proxyKeyId, cost, 1);
  }

  /**
   * List all provider keys for a user
   */
  async getProviderKeys(userId: string): Promise<ProviderKey[]> {
    return this.providerKeyModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * List all proxy keys for a user, optionally by project
   */
  async getProxyKeys(userId: string, projectId?: string): Promise<ProxyKey[]> {
    const query: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
    };
    if (projectId) {
      query.projectId = new Types.ObjectId(projectId);
    }
    return this.proxyKeyModel
      .find(query)
      .select(
        'keyId name description isActive usageStats createdAt providerKeyId projectId expiresAt budgetLimit dailyBudgetLimit monthlyBudgetLimit rateLimit allowedIPs allowedDomains permissions',
      )
      .populate('providerKeyId', 'name provider maskedKey')
      .populate('projectId', 'name')
      .lean()
      .sort({ createdAt: -1 }) as Promise<ProxyKey[]>;
  }

  /**
   * Delete a provider key and all associated proxy keys
   */
  async deleteProviderKey(
    userId: string,
    providerKeyId: string,
  ): Promise<void> {
    const providerKey = await this.providerKeyModel.findOne({
      _id: new Types.ObjectId(providerKeyId),
      userId: new Types.ObjectId(userId),
    });

    if (!providerKey) {
      throw new NotFoundException('Provider key not found');
    }

    await this.proxyKeyModel.deleteMany({
      providerKeyId: new Types.ObjectId(providerKeyId),
    });
    await this.providerKeyModel.deleteOne({
      _id: new Types.ObjectId(providerKeyId),
    });

    this.logger.log('Provider key deleted', {
      userId,
      providerKeyId,
      provider: providerKey.provider,
    });
  }

  /**
   * Delete a proxy key
   */
  async deleteProxyKey(userId: string, proxyKeyId: string): Promise<void> {
    const result = await this.proxyKeyModel.deleteOne({
      keyId: proxyKeyId,
      userId: new Types.ObjectId(userId),
    });

    if (result.deletedCount === 0) {
      throw new NotFoundException('Proxy key not found');
    }

    this.logger.log('Proxy key deleted', { userId, proxyKeyId });
  }

  /**
   * Toggle proxy key active status
   */
  async toggleProxyKey(
    userId: string,
    proxyKeyId: string,
    isActive: boolean,
  ): Promise<ProxyKey> {
    const proxyKey = await this.proxyKeyModel
      .findOneAndUpdate(
        { keyId: proxyKeyId, userId: new Types.ObjectId(userId) },
        { isActive },
        { new: true },
      )
      .exec();

    if (!proxyKey) {
      throw new NotFoundException('Proxy key not found');
    }

    this.logger.log('Proxy key status updated', {
      userId,
      proxyKeyId,
      isActive,
    });

    return proxyKey;
  }

  /**
   * Get proxy key analytics (aggregate)
   */
  async getProxyKeyAnalytics(
    userId: string,
    proxyKeyId?: string,
  ): Promise<{
    totalKeys: number;
    activeKeys: number;
    totalRequests: number;
    totalCost: number;
    dailyCost: number;
    monthlyCost: number;
  }> {
    const match: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
    };
    if (proxyKeyId) {
      match.keyId = proxyKeyId;
    }

    const result = await this.proxyKeyModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalKeys: { $sum: 1 },
          activeKeys: { $sum: { $cond: ['$isActive', 1, 0] } },
          totalRequests: { $sum: '$usageStats.totalRequests' },
          totalCost: { $sum: '$usageStats.totalCost' },
          dailyCost: { $sum: '$usageStats.dailyCost' },
          monthlyCost: { $sum: '$usageStats.monthlyCost' },
        },
      },
    ]);

    return (
      result[0] ?? {
        totalKeys: 0,
        activeKeys: 0,
        totalRequests: 0,
        totalCost: 0,
        dailyCost: 0,
        monthlyCost: 0,
      }
    );
  }

  /**
   * Get unified dashboard data.
   * Uses getProviderKeys and getProxyKeys for reliable fetching (same as dedicated endpoints).
   * Analytics from proxy key aggregation.
   */
  async getDashboardData(userId: string): Promise<{
    providerKeys: Array<Record<string, unknown>>;
    proxyKeys: Array<Record<string, unknown>>;
    analytics: {
      totalProviderKeys: number;
      totalActiveProviderKeys: number;
      totalKeys: number;
      activeKeys: number;
      totalRequests: number;
      totalCost: number;
      dailyCost: number;
      monthlyCost: number;
    };
  }> {
    const userIdObj = new Types.ObjectId(userId);

    const [providerKeysRaw, proxyKeysRaw, proxyAnalyticsResult] =
      await Promise.all([
        this.providerKeyModel
          .find({ userId: userIdObj })
          .select(
            '_id name provider maskedKey description isActive createdAt lastUsed',
          )
          .sort({ createdAt: -1 })
          .lean()
          .exec(),
        this.getProxyKeys(userId),
        this.proxyKeyModel.aggregate([
          { $match: { userId: userIdObj } },
          {
            $group: {
              _id: null,
              totalKeys: { $sum: 1 },
              activeKeys: { $sum: { $cond: ['$isActive', 1, 0] } },
              totalRequests: { $sum: '$usageStats.totalRequests' },
              totalCost: { $sum: '$usageStats.totalCost' },
              dailyCost: { $sum: '$usageStats.dailyCost' },
              monthlyCost: { $sum: '$usageStats.monthlyCost' },
            },
          },
        ]),
      ]);

    const providerKeysList = (providerKeysRaw ?? []) as Array<
      Record<string, unknown>
    >;
    const totalProviderKeys = providerKeysList.length;
    const totalActiveProviderKeys = providerKeysList.filter(
      (pk) => pk.isActive === true,
    ).length;

    // Map proxy keys: frontend expects providerKey as array, Mongoose populate returns providerKeyId as object
    const proxyKeys = (proxyKeysRaw ?? []).map((pk) => {
      const doc = pk as unknown as Record<string, unknown>;
      const providerKeyObj = doc.providerKeyId as
        | Record<string, unknown>
        | undefined;
      return {
        ...doc,
        providerKey: providerKeyObj ? [providerKeyObj] : [],
        providerKeyId: undefined,
      } as Record<string, unknown>;
    });

    const proxyAnalytics = proxyAnalyticsResult[0];

    return {
      providerKeys: providerKeysList,
      proxyKeys,
      analytics: {
        totalProviderKeys,
        totalActiveProviderKeys,
        totalKeys: proxyAnalytics?.totalKeys ?? 0,
        activeKeys: proxyAnalytics?.activeKeys ?? 0,
        totalRequests: proxyAnalytics?.totalRequests ?? 0,
        totalCost: proxyAnalytics?.totalCost ?? 0,
        dailyCost: proxyAnalytics?.dailyCost ?? 0,
        monthlyCost: proxyAnalytics?.monthlyCost ?? 0,
      },
    };
  }

  /**
   * Validate if a proxy key can be used for a specific project/user
   */
  async validateProxyKeyAccess(
    proxyKeyId: string,
    projectId?: string,
    userId?: string,
  ): Promise<{
    valid: boolean;
    proxyKey?: ProxyKey;
    provider?: string;
    reason?: string;
  }> {
    try {
      const resolved = await this.resolveProxyKey(proxyKeyId);
      if (!resolved) {
        return { valid: false, reason: 'Invalid or inactive proxy key' };
      }

      const { proxyKey, providerKey } = resolved;

      if (userId && !proxyKey.canBeUsedBy(userId)) {
        return {
          valid: false,
          reason: 'User not authorized to use this proxy key',
        };
      }

      if (projectId && !proxyKey.canAccessProject(projectId)) {
        return {
          valid: false,
          reason: 'Proxy key not authorized for this project',
        };
      }

      return {
        valid: true,
        proxyKey,
        provider: providerKey.provider,
      };
    } catch (error) {
      this.logger.error('Error validating proxy key access', {
        proxyKeyId,
        projectId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { valid: false, reason: 'Validation error' };
    }
  }

  private generateProxyKeyId(): string {
    return `ck-proxy-${randomBytes(16).toString('hex')}`;
  }

  private maskApiKey(apiKey: string): string {
    if (apiKey.length <= 8) {
      return '*'.repeat(apiKey.length);
    }
    const start = apiKey.slice(0, 4);
    const end = apiKey.slice(-4);
    // Use reasonable mask length (8-12 chars) to prevent layout overflow
    const middleLen = Math.min(
      12,
      Math.max(4, Math.min(apiKey.length - 8, 12)),
    );
    const middle = '*'.repeat(middleLen);
    return `${start}${middle}${end}`;
  }

  private async validateProviderKey(
    userId: string,
    providerKeyId: string,
  ): Promise<void> {
    const providerKey = await this.providerKeyModel
      .findOne({
        _id: new Types.ObjectId(providerKeyId),
        userId: new Types.ObjectId(userId),
        isActive: true,
      })
      .lean();

    if (!providerKey) {
      throw new NotFoundException('Provider key not found or not accessible');
    }
  }

  private async validateProject(
    userId: string,
    projectId: string,
  ): Promise<void> {
    const project = await this.projectModel
      .findOne({
        _id: new Types.ObjectId(projectId),
        ownerId: new Types.ObjectId(userId),
      })
      .lean();

    if (!project) {
      throw new NotFoundException('Project not found or not accessible');
    }
  }
}
