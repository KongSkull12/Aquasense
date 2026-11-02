/**
 * SMS routes
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { sendTestSms, getSmsRecipients, saveSmsRecipientsHandler } from '../controllers/smsController';
import { authenticateToken, requireRole } from '../../../middleware/authMiddleware';
import { validateBody, smsTestSchema, smsRecipientsSchema } from '../../../middleware/validate';

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

router.get('/sms/recipients', authenticateToken, requireRole(['admin', 'farmer']), getSmsRecipients);
router.put('/sms/recipients', authenticateToken, requireRole(['admin', 'farmer']), validateBody(smsRecipientsSchema), saveSmsRecipientsHandler);
router.post('/sms/test', authenticateToken, requireRole(['admin', 'farmer']), smsTestLimiter, validateBody(smsTestSchema), sendTestSms);

export default router;
