/**
 * Authentication Routes
 * Base path: /api/v1/auth
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { signup, login, logout, verifyToken } from '../controllers/authController';
import { validateBody } from '../../../middleware/validate';
import { z } from 'zod';

const router = Router();
const credentialsSchema = z.object({ email: z.string().trim().email().max(255), password: z.string().min(1).max(256) }).strict();
const signupSchema = credentialsSchema.extend({ fullName: z.string().trim().min(1).max(255) }).strict();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    statusCode: 429,
    message: 'Too many authentication attempts. Please try again later.',
  },
});

/**
 * Authentication endpoints
 */

// Signup route
router.post('/signup', authLimiter, validateBody(signupSchema), signup);

// Login route
router.post('/login', authLimiter, validateBody(credentialsSchema), login);

// Logout route
router.post('/logout', logout);

// Verify token route
router.get('/verify', verifyToken);

export default router;
