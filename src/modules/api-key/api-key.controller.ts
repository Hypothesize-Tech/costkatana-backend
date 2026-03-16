import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiKeyService } from './api-key.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { KeyIdParamDto } from './dto/key-id-param.dto';

/**
 * API Key Management (ChatGPT integration keys).
 * Base path: api-keys (no global prefix; set per controller).
 */
@Controller('api/api-keys')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ApiKeyController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  @Post()
  @RequirePermissions('write')
  @HttpCode(HttpStatus.CREATED)
  async generateApiKey(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateApiKeyDto,
    @Req() req: Request,
  ) {
    const requestId = (req.headers['x-request-id'] as string) || undefined;
    const result = await this.apiKeyService.generateApiKey(
      user.id,
      dto.name,
      requestId,
    );
    return {
      success: true,
      message: 'API key generated successfully',
      data: {
        id: result.id,
        name: result.name,
        key: result.key,
        created: result.created,
        usage_instructions: result.usage_instructions,
      },
    };
  }

  @Get()
  @RequirePermissions('read')
  async listApiKeys(@CurrentUser() user: { id: string }, @Req() req: Request) {
    const requestId = (req.headers['x-request-id'] as string) || undefined;
    const result = await this.apiKeyService.listApiKeys(user.id, requestId);
    return {
      success: true,
      data: result.data,
      total: result.total,
      active: result.active,
      ...(result.total === 0 && { message: 'No API keys found' }),
    };
  }

  @Patch(':keyId/deactivate')
  @RequirePermissions('write')
  async deactivateApiKey(
    @CurrentUser() user: { id: string },
    @Param() params: KeyIdParamDto,
    @Req() req: Request,
  ) {
    const requestId = (req.headers['x-request-id'] as string) || undefined;
    const data = await this.apiKeyService.deactivateApiKey(
      user.id,
      params.keyId,
      requestId,
    );
    return {
      success: true,
      message: 'API key deactivated successfully',
      data,
    };
  }

  @Patch(':keyId/regenerate')
  @RequirePermissions('write')
  async regenerateApiKey(
    @CurrentUser() user: { id: string },
    @Param() params: KeyIdParamDto,
    @Req() req: Request,
  ) {
    const requestId = (req.headers['x-request-id'] as string) || undefined;
    const data = await this.apiKeyService.regenerateApiKey(
      user.id,
      params.keyId,
      requestId,
    );
    return {
      success: true,
      message: 'API key regenerated successfully',
      data,
    };
  }
}
