import { Controller, Post, Body, Logger } from '@nestjs/common';
import { LinkMetadataService } from './services/link-metadata.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ZodPipe } from '../../common/pipes/zod-validation.pipe';
import { extractLinkMetadataSchema } from './dto/extract-link-metadata.dto';
import { extractUrlsSchema } from './dto/extract-urls.dto';
import type { ExtractLinkMetadataDto } from './dto/extract-link-metadata.dto';
import type { ExtractUrlsDto } from './dto/extract-urls.dto';
import { UseGuards } from '@nestjs/common';

@Controller('api/utils')
@UseGuards(JwtAuthGuard)
export class UtilsController {
  private readonly logger = new Logger(UtilsController.name);

  constructor(private readonly linkMetadataService: LinkMetadataService) {}

  /**
   * POST /api/utils/extract-link-metadata
   * Extract metadata (title, description, image) from a URL
   */
  @Post('extract-link-metadata')
  async extractLinkMetadata(
    @Body(ZodPipe(extractLinkMetadataSchema)) body: ExtractLinkMetadataDto,
  ): Promise<{
    success: boolean;
    data?: any;
    error?: string;
    message?: string;
  }> {
    try {
      const { url } = body;

      // Validate URL format
      if (!this.linkMetadataService.isValidUrl(url)) {
        return {
          success: false,
          error: 'Invalid URL format',
        };
      }

      // Extract metadata
      const metadata = await this.linkMetadataService.extractLinkMetadata(url);

      return {
        success: true,
        data: metadata,
      };
    } catch (error) {
      this.logger.error('Error extracting link metadata:', error);

      return {
        success: false,
        error: 'Failed to extract link metadata',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * POST /api/utils/extract-urls
   * Extract all URLs from a text string
   */
  @Post('extract-urls')
  async extractUrls(
    @Body(ZodPipe(extractUrlsSchema)) body: ExtractUrlsDto,
  ): Promise<{
    success: boolean;
    data?: { urls: string[]; count: number };
    error?: string;
  }> {
    try {
      const { text } = body;

      const urls = this.linkMetadataService.extractUrlsFromText(text);

      return {
        success: true,
        data: {
          urls,
          count: urls.length,
        },
      };
    } catch (error) {
      this.logger.error('Error extracting URLs:', error);

      return {
        success: false,
        error: 'Failed to extract URLs',
      };
    }
  }
}
