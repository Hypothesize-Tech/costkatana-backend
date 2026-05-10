import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PromptVersionService } from './services/prompt-version.service';

interface CreateVersionBody {
  content: string;
  changeNote?: string;
  agentId?: string;
  nodeId?: string;
}

@Controller('api/prompt-templates')
@UseGuards(JwtAuthGuard)
export class PromptVersionController {
  private readonly logger = new Logger(PromptVersionController.name);

  constructor(private readonly promptVersionService: PromptVersionService) {}

  @Get(':templateId/versions')
  async listVersions(
    @CurrentUser('id') userId: string,
    @Param('templateId') templateId: string,
  ) {
    const versions = await this.promptVersionService.listVersions(
      templateId,
      userId,
    );
    return { success: true, versions };
  }

  @Post(':templateId/versions')
  @HttpCode(HttpStatus.CREATED)
  async createVersion(
    @CurrentUser('id') userId: string,
    @Param('templateId') templateId: string,
    @Body() body: CreateVersionBody,
  ) {
    const version = await this.promptVersionService.createVersion(userId, {
      templateId,
      content: body.content,
      changeNote: body.changeNote,
      agentId: body.agentId,
      nodeId: body.nodeId,
    });
    return { success: true, version };
  }

  @Get(':templateId/versions/diff')
  async diff(
    @CurrentUser('id') userId: string,
    @Param('templateId') templateId: string,
    @Query('from', ParseIntPipe) from: number,
    @Query('to', ParseIntPipe) to: number,
  ) {
    const diff = await this.promptVersionService.diff(
      templateId,
      from,
      to,
      userId,
    );
    return { success: true, diff };
  }

  @Get(':templateId/versions/:version')
  async getVersion(
    @CurrentUser('id') userId: string,
    @Param('templateId') templateId: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    const v = await this.promptVersionService.getVersion(
      templateId,
      version,
      userId,
    );
    return { success: true, version: v };
  }

  @Put(':templateId/versions/:version/pin')
  async pinVersion(
    @CurrentUser('id') userId: string,
    @Param('templateId') templateId: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    const template = await this.promptVersionService.pinVersion(
      templateId,
      version,
      userId,
    );
    return { success: true, template };
  }

  @Post(':templateId/versions/:version/restore')
  async restore(
    @CurrentUser('id') userId: string,
    @Param('templateId') templateId: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    const newVersion = await this.promptVersionService.restoreVersion(
      templateId,
      version,
      userId,
    );
    return { success: true, version: newVersion };
  }
}
