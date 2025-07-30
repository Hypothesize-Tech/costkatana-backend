import { Router } from 'express';
import { KeyVaultController } from '../controllers/keyVault.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Dashboard route - get overview of all keys and analytics
router.get('/dashboard', KeyVaultController.getDashboard);

// Provider Key routes
router.post('/provider-keys', KeyVaultController.createProviderKey);
router.get('/provider-keys', KeyVaultController.getProviderKeys);
router.delete('/provider-keys/:providerKeyId', KeyVaultController.deleteProviderKey);

// Proxy Key routes
router.post('/proxy-keys', KeyVaultController.createProxyKey);
router.get('/proxy-keys', KeyVaultController.getProxyKeys);
router.delete('/proxy-keys/:proxyKeyId', KeyVaultController.deleteProxyKey);
router.patch('/proxy-keys/:proxyKeyId/status', KeyVaultController.updateProxyKeyStatus);

// Analytics routes
router.get('/analytics', KeyVaultController.getProxyKeyAnalytics);

export default router;