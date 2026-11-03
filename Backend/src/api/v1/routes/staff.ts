import { Router } from 'express';
import { authenticateToken, requireRole } from '../../../middleware/authMiddleware';
import { validateBody, validateParams, createStaffSchema, idParamSchema } from '../../../middleware/validate';
import { createStaffAccount, listStaffAccounts, removeStaffAccount } from '../controllers/staffController';

const router = Router();

router.get('/staff', authenticateToken, requireRole(['admin']), listStaffAccounts);
router.post('/staff', authenticateToken, requireRole(['admin']), validateBody(createStaffSchema), createStaffAccount);
router.delete('/staff/:id', authenticateToken, requireRole(['admin']), validateParams(idParamSchema), removeStaffAccount);

export default router;
