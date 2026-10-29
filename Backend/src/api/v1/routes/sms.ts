/**
 * SMS routes
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { sendTestSms } from '../controllers/smsController';
import { authenticateToken, requireRole } from '../../../middleware/authMiddleware';
import { validateBody, smsTestSchema } from '../../../middleware/validate';

const router = Router();

const smsTestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    statusCode: 429,
    message: 'Too many SMS test attempts. Please try again later.',
  },
});

router.post('/sms/test', authenticateToken, requireRole(['admin', 'farmer']), smsTestLimiter, validateBody(smsTestSchema), sendTestSms);

export default router;
