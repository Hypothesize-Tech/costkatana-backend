import { Router } from 'express';
import { BillingController } from '../controllers/billing.controller';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Invoice routes
router.get('/invoices', asyncHandler(BillingController.getInvoices));
router.get('/invoices/upcoming', asyncHandler(BillingController.getUpcomingInvoice));
router.get('/invoices/:invoiceId', asyncHandler(BillingController.getInvoice));

// Payment method routes
router.get('/payment-methods', asyncHandler(BillingController.getPaymentMethods));
router.post('/payment-methods/razorpay/create-order', asyncHandler(BillingController.createRazorpayPaymentMethodOrder));
router.post('/payment-methods/razorpay/save', asyncHandler(BillingController.saveRazorpayPaymentMethod));
router.post('/payment-methods', asyncHandler(BillingController.addPaymentMethod));
router.put('/payment-methods/:paymentMethodId', asyncHandler(BillingController.updatePaymentMethod));
router.delete('/payment-methods/:paymentMethodId', asyncHandler(BillingController.removePaymentMethod));

// Payment gateway configuration (public keys)
router.get('/payment-config', asyncHandler(BillingController.getPaymentConfig));

export default router;

