import { Router } from 'express';
import { authenticateToken, requireRole } from '../../../middleware/authMiddleware';
import { validateBody, validateParams, createStaffSchema, idParamSchema } from '../../../middleware/validate';
import { createStaffAccount, listStaffAccounts, removeStaffAccount } from '../controllers/staffController';

const router = Router();

router.get('/staff', authenticateToken, requireRole(['admin', 'farmer']), listStaffAccounts);
router.post('/staff', authenticateToken, requireRole(['admin', 'farmer']), validateBody(createStaffSchema), createStaffAccount);
router.delete('/staff/:id', authenticateToken, requireRole(['admin', 'farmer']), validateParams(idParamSchema), removeStaffAccount);

export default router;
