import { Controller, Post, Req, Res, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { PaymentGatewayService } from '../payment-gateway/payment-gateway.service';
import { PaymentWebhookService } from './payment-webhook.service';

@Controller('api/webhooks/payment')
export class PaymentWebhookController {
  private readonly logger = new Logger(PaymentWebhookController.name);

  constructor(
    private paymentGatewayService: PaymentGatewayService,
    private paymentWebhookService: PaymentWebhookService,
  ) {}

  /**
   * Stripe Webhook Handler
   * POST /api/webhooks/payment/stripe
   */
  @Post('stripe')
  async handleStripeWebhook(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const signature = req.headers['stripe-signature'] as string;
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);

    try {
      // Verify webhook signature
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!webhookSecret) {
        this.logger.error('Stripe webhook secret not configured');
        res.status(500).json({ error: 'Webhook secret not configured' });
        return;
      }

      if (
        !this.paymentGatewayService.verifyWebhookSignature(
          'stripe',
          rawBody,
          signature,
          webhookSecret,
        )
      ) {
        this.logger.warn('Invalid Stripe webhook signature', {
          hasSignature: !!signature,
        });
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }

      const event = this.paymentGatewayService.parseWebhookEvent(
        'stripe',
        req.body,
        req.headers as Record<string, string>,
      );

      // Process webhook asynchronously (respond quickly to Stripe)
      setImmediate(async () => {
        try {
          await this.paymentWebhookService.processStripeEvent(event);
        } catch (error: any) {
          this.logger.error('Error processing Stripe webhook event', {
            eventId: event.id,
            eventType: event.type,
            error: error.message,
          });
        }
      });

      // Respond immediately to Stripe
      res.status(200).json({ received: true });
    } catch (error: any) {
      this.logger.error('Stripe webhook handler error', {
        error: error.message,
        stack: error.stack,
      });
      res.status(400).json({ error: 'Webhook processing failed' });
    }
  }

  /**
   * Razorpay Webhook Handler
   * POST /api/webhooks/payment/razorpay
   */
  @Post('razorpay')
  async handleRazorpayWebhook(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const signature = req.headers['x-razorpay-signature'] as string;
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);

    try {
      const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
      if (!webhookSecret) {
        this.logger.error('Razorpay webhook secret not configured');
        res.status(500).json({ error: 'Webhook secret not configured' });
        return;
      }

      if (
        !this.paymentGatewayService.verifyWebhookSignature(
          'razorpay',
          rawBody,
          signature,
          webhookSecret,
        )
      ) {
        this.logger.warn('Invalid Razorpay webhook signature');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }

      const event = this.paymentGatewayService.parseWebhookEvent(
        'razorpay',
        req.body,
        req.headers as Record<string, string>,
      );

      setImmediate(async () => {
        try {
          await this.paymentWebhookService.processRazorpayEvent(event);
        } catch (error: any) {
          this.logger.error('Error processing Razorpay webhook event', {
            eventId: event.id,
            eventType: event.type,
            error: error.message,
          });
        }
      });

      res.status(200).json({ received: true });
    } catch (error: any) {
      this.logger.error('Razorpay webhook handler error', {
        error: error.message,
      });
      res.status(400).json({ error: 'Webhook processing failed' });
    }
  }

  /**
   * PayPal Webhook Handler
   * POST /api/webhooks/payment/paypal
   */
  @Post('paypal')
  async handlePayPalWebhook(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const signature = req.headers['paypal-transmission-sig'] as string;
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);

    try {
      const webhookSecret =
        process.env.PAYPAL_WEBHOOK_SECRET || process.env.PAYPAL_WEBHOOK_ID;
      if (!webhookSecret) {
        this.logger.error('PayPal webhook secret not configured');
        res.status(500).json({ error: 'Webhook secret not configured' });
        return;
      }

      if (
        !this.paymentGatewayService.verifyWebhookSignature(
          'paypal',
          rawBody,
          signature,
          webhookSecret,
        )
      ) {
        this.logger.warn('Invalid PayPal webhook signature');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }

      const event = this.paymentGatewayService.parseWebhookEvent(
        'paypal',
        req.body,
        req.headers as Record<string, string>,
      );

      setImmediate(async () => {
        try {
          await this.paymentWebhookService.processPayPalEvent(event);
        } catch (error: any) {
          this.logger.error('Error processing PayPal webhook event', {
            eventId: event.id,
            eventType: event.type,
            error: error.message,
          });
        }
      });

      res.status(200).json({ received: true });
    } catch (error: any) {
      this.logger.error('PayPal webhook handler error', {
        error: error.message,
      });
      res.status(400).json({ error: 'Webhook processing failed' });
    }
  }
}
