import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { WebhookService } from '../../modules/webhook/webhook.service';

@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  private readonly logger = new Logger(WebhookSignatureGuard.name);

  constructor(private readonly webhookService: WebhookService) {}

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();
    const startTime = Date.now();

    this.logger.log('=== WEBHOOK SIGNATURE VERIFICATION GUARD STARTED ===', {
      component: 'WebhookSignatureGuard',
      operation: 'canActivate',
      type: 'webhook_signature',
      path: request.path,
      method: request.method,
    });

    try {
      this.logger.log('Step 1: Extracting webhook signature and timestamp', {
        component: 'WebhookSignatureGuard',
        operation: 'canActivate',
        type: 'webhook_signature',
        step: 'extract_signature',
      });

      // Get signature from headers
      const signature = request.headers['x-costkatana-signature'] as string;
      const timestamp = request.headers['x-costkatana-timestamp'] as string;

      this.logger.log('Webhook headers extracted', {
        component: 'WebhookSignatureGuard',
        operation: 'canActivate',
        type: 'webhook_signature',
        step: 'headers_extracted',
        hasSignature: !!signature,
        hasTimestamp: !!timestamp,
        signatureLength: signature?.length || 0,
        timestamp,
      });

      if (!signature || !timestamp) {
        this.logger.warn('Missing webhook signature or timestamp', {
          component: 'WebhookSignatureGuard',
          operation: 'canActivate',
          type: 'webhook_signature',
          step: 'missing_credentials',
          ip: request.ip,
          path: request.path,
          hasSignature: !!signature,
          hasTimestamp: !!timestamp,
        });
        return false;
      }

      this.logger.log(
        'Step 2: Validating webhook timestamp to prevent replay attacks',
        {
          component: 'WebhookSignatureGuard',
          operation: 'canActivate',
          type: 'webhook_signature',
          step: 'validate_timestamp',
        },
      );

      // Check timestamp to prevent replay attacks (5 minutes tolerance)
      const currentTime = Date.now();
      const webhookTime = parseInt(timestamp);
      const timeDifference = Math.abs(currentTime - webhookTime);
      const tolerance = 300000; // 5 minutes

      this.logger.log('Timestamp validation details', {
        component: 'WebhookSignatureGuard',
        operation: 'canActivate',
        type: 'webhook_signature',
        step: 'timestamp_analysis',
        currentTime,
        webhookTime,
        timeDifference,
        tolerance,
        isWithinTolerance: timeDifference <= tolerance,
      });

      if (timeDifference > tolerance) {
        this.logger.warn('Webhook timestamp too old', {
          component: 'WebhookSignatureGuard',
          operation: 'canActivate',
          type: 'webhook_signature',
          step: 'timestamp_expired',
          ip: request.ip,
          path: request.path,
          timestamp,
          timeDifference,
          tolerance,
        });
        return false;
      }

      this.logger.log(
        'Step 3: Retrieving webhook secret for signature verification',
        {
          component: 'WebhookSignatureGuard',
          operation: 'canActivate',
          type: 'webhook_signature',
          step: 'get_secret',
        },
      );

      // Get secret from environment
      const secret = process.env.WEBHOOK_SECRET;
      if (!secret) {
        this.logger.error('No webhook secret configured', {
          component: 'WebhookSignatureGuard',
          operation: 'canActivate',
          type: 'webhook_signature',
          step: 'no_secret_configured',
        });
        return false;
      }

      this.logger.log('Webhook secret retrieved successfully', {
        component: 'WebhookSignatureGuard',
        operation: 'canActivate',
        type: 'webhook_signature',
        step: 'secret_retrieved',
        hasSecret: !!secret,
      });

      this.logger.log('Step 4: Verifying webhook signature', {
        component: 'WebhookSignatureGuard',
        operation: 'canActivate',
        type: 'webhook_signature',
        step: 'verify_signature',
      });

      // Verify signature
      const payload = JSON.stringify(request.body);
      const isValid = this.webhookService.verifySignature(
        secret,
        payload,
        timestamp,
        signature,
      );

      this.logger.log('Signature verification completed', {
        component: 'WebhookSignatureGuard',
        operation: 'canActivate',
        type: 'webhook_signature',
        step: 'signature_verified',
        isValid,
        payloadLength: payload.length,
        signatureLength: signature.length,
      });

      if (!isValid) {
        this.logger.warn('Invalid webhook signature', {
          component: 'WebhookSignatureGuard',
          operation: 'canActivate',
          type: 'webhook_signature',
          step: 'invalid_signature',
          ip: request.ip,
          path: request.path,
          signature,
          timestamp,
        });
        return false;
      }

      this.logger.log('Webhook signature verification completed successfully', {
        component: 'WebhookSignatureGuard',
        operation: 'canActivate',
        type: 'webhook_signature',
        step: 'verification_success',
        totalTime: `${Date.now() - startTime}ms`,
      });

      this.logger.log(
        '=== WEBHOOK SIGNATURE VERIFICATION GUARD COMPLETED ===',
        {
          component: 'WebhookSignatureGuard',
          operation: 'canActivate',
          type: 'webhook_signature',
          step: 'completed',
          totalTime: `${Date.now() - startTime}ms`,
        },
      );

      return true;
    } catch (error) {
      this.logger.error('Webhook signature verification failed', {
        component: 'WebhookSignatureGuard',
        operation: 'canActivate',
        type: 'webhook_signature',
        step: 'error',
        error: error instanceof Error ? error.message : String(error),
        totalTime: `${Date.now() - startTime}ms`,
      });
      return false;
    }
  }
}
