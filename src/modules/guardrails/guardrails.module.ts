import { Module, forwardRef } from '@nestjs/common';
import { GuardrailsController } from './guardrails.controller';
import { GuardrailsService } from './guardrails.service';
import { GuardrailsGuard } from './guards/guardrails.guard';
import { SchemasModule } from '../../schemas/schemas.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { CortexModule } from '../cortex/cortex.module';
import { EmailModule } from '../email/email.module';
import { UtilsModule } from '../utils/utils.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    SchemasModule,
    SubscriptionModule,
    forwardRef(() => CortexModule),
    EmailModule,
    forwardRef(() => UtilsModule),
    AuthModule,
  ],
  controllers: [GuardrailsController],
  providers: [GuardrailsService, GuardrailsGuard],
  exports: [GuardrailsService, GuardrailsGuard],
})
export class GuardrailsModule {}
