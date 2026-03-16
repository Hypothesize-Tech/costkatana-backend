import {
  Controller,
  Post,
  Param,
  Body,
  UseGuards,
  HttpStatus,
  HttpCode,
  Logger,
} from '@nestjs/common';
import { ProactiveSuggestionsService } from './services/proactive-suggestions.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RejectSuggestionDto } from './dto/reject-suggestion.dto';

@Controller('api/proactive-suggestions')
@UseGuards(JwtAuthGuard)
export class ProactiveSuggestionsController {
  private readonly logger = new Logger(ProactiveSuggestionsController.name);

  constructor(
    private readonly proactiveSuggestionsService: ProactiveSuggestionsService,
  ) {}

  /**
   * Accept a proactive suggestion
   * POST /api/proactive-suggestions/accept/:suggestionId
   */
  @Post('accept/:suggestionId')
  @HttpCode(HttpStatus.OK)
  async acceptSuggestion(
    @CurrentUser('id') userId: string,
    @Param('suggestionId') suggestionId: string,
  ) {
    await this.proactiveSuggestionsService.trackSuggestionAcceptance(
      suggestionId,
      userId,
    );
    this.logger.log('Proactive suggestion accepted', {
      suggestionId,
      userId,
    });
    return {
      success: true,
      message: 'Suggestion accepted successfully',
      suggestionId,
    };
  }

  /**
   * Reject a proactive suggestion
   * POST /api/proactive-suggestions/reject/:suggestionId
   */
  @Post('reject/:suggestionId')
  @HttpCode(HttpStatus.OK)
  async rejectSuggestion(
    @CurrentUser('id') userId: string,
    @Param('suggestionId') suggestionId: string,
    @Body() body: RejectSuggestionDto,
  ) {
    await this.proactiveSuggestionsService.trackSuggestionRejection(
      suggestionId,
      userId,
      body.reason,
    );
    this.logger.log('Proactive suggestion rejected', {
      suggestionId,
      userId,
      reason: body.reason,
    });
    return {
      success: true,
      message: 'Suggestion rejected successfully',
      suggestionId,
    };
  }
}
