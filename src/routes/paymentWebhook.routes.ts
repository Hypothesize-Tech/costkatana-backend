import { Router, Request, Response, NextFunction } from 'express';
import { PaymentWebhookController } from '../controllers/paymentWebhook.controller';

const router = Router();

/**
 * Middleware to capture raw body for webhook signature verification
 * Payment gateways require raw body (not parsed JSON) for signature verification
 */
const rawBodyMiddleware = (req: Request, _res: Response, next: NextFunction): void => {
    if (req.headers['content-type']?.includes('application/json')) {
        let data = '';
        req.on('data', (chunk: string) => {
            data += chunk;
        });
        req.on('end', () => {
            (req as any).rawBody = data;
            try {
                req.body = JSON.parse(data);
            } catch (e) {
                req.body = {};
            }
            next();
        });
    } else {
        next();
    }
};

/**
 * Payment Webhook Routes
 * 
 * These routes handle webhooks from payment gateways.
 * IMPORTANT: These routes should NOT require authentication as they are called by payment gateways.
 * Security is ensured through webhook signature verification.
 * 
 * Webhook URLs should be configured in payment gateway dashboards:
 * - Stripe: https://your-domain.com/api/webhooks/payment/stripe
 * - Razorpay: https://your-domain.com/api/webhooks/payment/razorpay
 * - PayPal: https://your-domain.com/api/webhooks/payment/paypal
 */

// Stripe webhook endpoint
router.post(
    '/stripe',
    rawBodyMiddleware,
    PaymentWebhookController.handleStripeWebhook
);

// Razorpay webhook endpoint
router.post(
    '/razorpay',
    rawBodyMiddleware,
    PaymentWebhookController.handleRazorpayWebhook
);

// PayPal webhook endpoint
router.post(
    '/paypal',
    rawBodyMiddleware,
    PaymentWebhookController.handlePayPalWebhook
);

export default router;

