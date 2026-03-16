import { Module, forwardRef } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { SchemasModule } from '../../schemas/schemas.module';
import { AuthModule } from '../auth/auth.module';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { WebhookEventEmitterService } from './webhook-event-emitter.service';

@Module({
  imports: [
    forwardRef(() => CommonModule),
    SchemasModule,
    AuthModule, // JwtService, User model, UserSessionService for JwtAuthGuard
  ],
  controllers: [WebhookController],
  providers: [
    WebhookService,
    WebhookDeliveryService,
    WebhookEventEmitterService,
  ],
  exports: [WebhookService, WebhookEventEmitterService, WebhookDeliveryService],
})
export class WebhookModule {}
