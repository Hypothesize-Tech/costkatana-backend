import { Router } from 'express';
import { MFAController } from '../controllers/mfa.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authenticateMFA } from '../middleware/mfa.middleware';
import { rateLimit } from 'express-rate-limit';

const router = Router();

// Rate limiting for MFA operations
const mfaRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 requests per windowMs
    message: {
        success: false,
        message: 'Too many MFA requests, please try again later.',
    },
    standardHeaders: true,
    legacyHeaders: false,
});

const strictMfaRateLimit = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 5, // Limit each IP to 5 requests per windowMs for sensitive operations
    message: {
        success: false,
        message: 'Too many verification attempts, please try again later.',
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Get MFA status
router.get('/status', authenticate, MFAController.getStatus);

// TOTP (Authenticator App) routes
router.post('/totp/setup', authenticate, mfaRateLimit, MFAController.setupTOTP);
router.post('/totp/verify', authenticate, strictMfaRateLimit, MFAController.verifyAndEnableTOTP);

// Email MFA routes
router.post('/email/send-code', authenticateMFA, mfaRateLimit, MFAController.sendEmailCode);
router.post('/email/verify', authenticate, strictMfaRateLimit, MFAController.verifyAndEnableEmailMFA);

// MFA verification during login (public route with rate limiting)
router.post('/verify', strictMfaRateLimit, MFAController.verifyMFA);

// Disable MFA
router.post('/disable', authenticate, MFAController.disableMFA);

// Trusted devices management
router.get('/trusted-devices/check', authenticate, MFAController.checkTrustedDevice);
router.post('/trusted-devices/add', authenticate, MFAController.addTrustedDevice);
router.delete('/trusted-devices/remove', authenticate, MFAController.removeTrustedDevice);

export default router;


