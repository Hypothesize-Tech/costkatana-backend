import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as crypto from 'crypto';
import { User, UserDocument } from '@/schemas/user/user.schema';
import { LoggerService } from '@/common/logger/logger.service';
import { BusinessEventLoggingService } from '@/common/services/business-event-logging.service';
import type {
  IApiKey,
  ApiKeyValidationResult,
} from './interfaces/api-key.interface';

const MAX_ACTIVE_KEYS = 5;
const API_KEY_PREFIX = 'ck_user_';

@Injectable()
export class ApiKeyService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly loggerService: LoggerService,
    private readonly businessLogging: BusinessEventLoggingService,
  ) {}

  /**
   * Generate a new ChatGPT integration API key for the user.
   * Format: ck_user_{userId}_{random}.
   */
  async generateApiKey(
    userId: string,
    name: string,
    requestId?: string,
  ): Promise<{
    id: string;
    name: string;
    key: string;
    created: Date;
    usage_instructions: {
      chatgpt_integration: string;
      header_format: string;
      example_usage: string;
    };
  }> {
    this.validateObjectId(userId, 'userId');
    const trimmedName = name?.trim();
    if (!trimmedName) {
      throw new BadRequestException('API key name is required');
    }

    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const apiKeys = (user as any).apiKeys ?? [];
    const activeKeys = apiKeys.filter((k: IApiKey) => k.isActive);
    if (activeKeys.length >= MAX_ACTIVE_KEYS) {
      throw new BadRequestException(
        'Maximum of 5 active API keys allowed. Please deactivate an existing key first.',
      );
    }

    const randomSuffix = crypto.randomBytes(16).toString('hex');
    const apiKeyValue = `${API_KEY_PREFIX}${userId}_${randomSuffix}`;
    const newKey: IApiKey = {
      id: crypto.randomBytes(8).toString('hex'),
      name: trimmedName,
      key: apiKeyValue,
      created: new Date(),
      isActive: true,
    };

    if (!(user as any).apiKeys) {
      (user as any).apiKeys = [];
    }
    (user as any).apiKeys.push(newKey);
    await user.save();

    this.loggerService.info('generateApiKey completed successfully', {
      userId,
      keyName: trimmedName,
      keyId: newKey.id,
      totalActiveKeys: activeKeys.length + 1,
      requestId,
    });

    this.businessLogging.logBusiness({
      event: 'api_key_generated',
      category: 'api_management',
      metadata: {
        userId,
        keyName: trimmedName,
        keyId: newKey.id,
        totalActiveKeys: activeKeys.length + 1,
      },
    });

    return {
      id: newKey.id,
      name: newKey.name,
      key: apiKeyValue,
      created: newKey.created,
      usage_instructions: {
        chatgpt_integration:
          'Use this key in your Custom GPT Actions authentication',
        header_format: `X-API-Key: ${apiKeyValue}`,
        example_usage:
          'Perfect for ChatGPT Custom GPT integration with Cost Katana',
      },
    };
  }

  /**
   * List user's API keys without exposing full key values.
   */
  async listApiKeys(
    userId: string,
    requestId?: string,
  ): Promise<{
    data: Array<{
      id: string;
      name: string;
      key_preview: string;
      created: Date;
      last_used: Date | null;
      is_active: boolean;
      status: string;
    }>;
    total: number;
    active: number;
  }> {
    this.validateObjectId(userId, 'userId');

    const user = await this.userModel.findById(userId).select('apiKeys').lean();
    if (!user || !(user as any).apiKeys?.length) {
      this.loggerService.info('listApiKeys completed successfully', {
        userId,
        totalKeys: 0,
        activeKeys: 0,
        requestId,
      });
      return { data: [], total: 0, active: 0 };
    }

    const apiKeysList = ((user as any).apiKeys as IApiKey[]).map((key) => ({
      id: key.id,
      name: key.name,
      key_preview: `${key.key.substring(0, 20)}...${key.key.slice(-4)}`,
      created: key.created,
      last_used: key.lastUsed ?? null,
      is_active: key.isActive,
      status: key.isActive ? 'Active' : 'Inactive',
    }));

    const activeCount = apiKeysList.filter((k) => k.is_active).length;

    this.loggerService.info('listApiKeys completed successfully', {
      userId,
      totalKeys: apiKeysList.length,
      activeKeys: activeCount,
      requestId,
    });

    this.businessLogging.logBusiness({
      event: 'api_keys_listed',
      category: 'api_management',
      metadata: {
        userId,
        totalKeys: apiKeysList.length,
        activeKeys: activeCount,
        inactiveKeys: apiKeysList.length - activeCount,
      },
    });

    return {
      data: apiKeysList,
      total: apiKeysList.length,
      active: activeCount,
    };
  }

  /**
   * Deactivate an API key by keyId.
   */
  async deactivateApiKey(
    userId: string,
    keyId: string,
    requestId?: string,
  ): Promise<{ id: string; name: string; status: string }> {
    this.validateObjectId(userId, 'userId');

    const user = await this.userModel.findById(userId);
    if (!user || !(user as any).apiKeys?.length) {
      throw new NotFoundException('API key not found');
    }

    const keys = (user as any).apiKeys as IApiKey[];
    const index = keys.findIndex((k) => k.id === keyId);
    if (index === -1) {
      throw new NotFoundException('API key not found');
    }

    const keyName = keys[index].name;
    const wasActive = keys[index].isActive;
    keys[index].isActive = false;
    await user.save();

    this.loggerService.info('deactivateApiKey completed successfully', {
      userId,
      keyId,
      keyName,
      wasActive,
      requestId,
    });

    this.businessLogging.logBusiness({
      event: 'api_key_deactivated',
      category: 'api_management',
      metadata: { userId, keyId, keyName, wasActive },
    });

    return { id: keyId, name: keyName, status: 'Inactive' };
  }

  /**
   * Regenerate an API key: new secret, reset lastUsed, set active.
   * Old key is invalid immediately.
   */
  async regenerateApiKey(
    userId: string,
    keyId: string,
    requestId?: string,
  ): Promise<{
    id: string;
    name: string;
    key: string;
    created: Date;
    warning: string;
  }> {
    this.validateObjectId(userId, 'userId');

    const user = await this.userModel.findById(userId);
    if (!user || !(user as any).apiKeys?.length) {
      throw new NotFoundException('API key not found');
    }

    const keys = (user as any).apiKeys as IApiKey[];
    const index = keys.findIndex((k) => k.id === keyId);
    if (index === -1) {
      throw new NotFoundException('API key not found');
    }

    const oldName = keys[index].name;
    const randomSuffix = crypto.randomBytes(16).toString('hex');
    const newApiKeyValue = `${API_KEY_PREFIX}${userId}_${randomSuffix}`;

    keys[index].key = newApiKeyValue;
    keys[index].created = new Date();
    keys[index].lastUsed = undefined;
    keys[index].isActive = true;
    await user.save();

    this.loggerService.info('regenerateApiKey completed successfully', {
      userId,
      keyId,
      keyName: oldName,
      requestId,
    });

    this.businessLogging.logBusiness({
      event: 'api_key_regenerated',
      category: 'api_management',
      metadata: { userId, keyId, keyName: oldName },
    });

    return {
      id: keyId,
      name: oldName,
      key: newApiKeyValue,
      created: keys[index].created,
      warning:
        'Please update this key in your ChatGPT Custom GPT Actions immediately. The old key is now invalid.',
    };
  }

  /**
   * Validate a ck_user_* API key and return user context.
   * Used internally by ChatGPT controller and other consumers.
   */
  async validateApiKey(apiKey: string): Promise<ApiKeyValidationResult | null> {
    const preview = `${apiKey.substring(0, 20)}...${apiKey.slice(-4)}`;

    const userIdMatch = apiKey.match(/ck_user_([a-f0-9]{24})/);
    if (!userIdMatch) {
      this.loggerService.warn('API key validation failed - invalid format', {
        apiKeyPreview: preview,
        requestId: 'internal',
      });
      return null;
    }

    const userId = userIdMatch[1];
    const user = await this.userModel.findById(userId);
    if (!user || !(user as any).apiKeys?.length) {
      this.loggerService.warn('API key validation failed - user not found', {
        userId,
        apiKeyPreview: preview,
        requestId: 'internal',
      });
      return null;
    }

    const keys = (user as any).apiKeys as IApiKey[];
    const matchingKey = keys.find((k) => k.key === apiKey && k.isActive);
    if (!matchingKey) {
      this.loggerService.warn(
        'API key validation failed - key not found or inactive',
        {
          userId,
          apiKeyPreview: preview,
          requestId: 'internal',
        },
      );
      return null;
    }

    matchingKey.lastUsed = new Date();
    await user.save();

    this.loggerService.info('API key validation successful', {
      userId,
      keyId: matchingKey.id,
      keyName: matchingKey.name,
      requestId: 'internal',
    });

    this.businessLogging.logBusiness({
      event: 'api_key_validated',
      category: 'api_management',
      metadata: {
        userId,
        keyId: matchingKey.id,
        keyName: matchingKey.name,
      },
    });

    return { userId, user };
  }

  private validateObjectId(id: string, fieldName: string): void {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`Invalid ${fieldName} format`);
    }
  }
}
