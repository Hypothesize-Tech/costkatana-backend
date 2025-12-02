import express from 'express';
import { authenticate, authorize } from '../../middleware/auth.middleware';
import { asyncHandler } from '../../middleware/error.middleware';
import { AdminDiscountController } from '../../controllers/adminDiscount.controller';

const router = express.Router();

// Apply authentication and admin authorization to all routes
router.use(authenticate);
router.use(authorize('admin'));

// Discount CRUD operations
router.get('/', asyncHandler(AdminDiscountController.getDiscounts));
router.get('/:id', asyncHandler(AdminDiscountController.getDiscount));
router.post('/', asyncHandler(AdminDiscountController.createDiscount));
router.put('/:id', asyncHandler(AdminDiscountController.updateDiscount));
router.delete('/:id', asyncHandler(AdminDiscountController.deleteDiscount));

// Usage statistics
router.get('/:id/usage', asyncHandler(AdminDiscountController.getDiscountUsage));

// Bulk operations
router.post('/bulk-activate', asyncHandler(AdminDiscountController.bulkActivate));
router.post('/bulk-deactivate', asyncHandler(AdminDiscountController.bulkDeactivate));
router.post('/bulk-delete', asyncHandler(AdminDiscountController.bulkDelete));

export default router;

