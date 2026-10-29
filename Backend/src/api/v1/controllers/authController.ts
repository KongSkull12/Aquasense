/**
 * Authentication Controllers
 * Handles signup and login logic
 */
import { Request, Response } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';
import { userService } from '../../../services/userService';
import { tokenService } from '../../../utils/tokenService';
import { sendSuccess, sendError } from '../../../utils/response';
import { logger } from '../../../utils/logger';
import { auditLogService } from '../../../services/auditLog.service';
import { config } from '../../../config/config';
import { clearCsrfCookie, createCsrfToken, csrfCookieName, getCookieValue, setCsrfCookie } from '../../../middleware/csrfProtection';

interface SignupRequest {
  fullName?: string;
  email?: string;
  password?: string;
}

interface LoginRequest {
  email?: string;
  password?: string;
}

const validatePasswordStrength = (password: string): string | null => {
  if (password.length < 12) {
    return 'Password must be at least 12 characters long';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must include an uppercase letter';
  }
  if (!/[a-z]/.test(password)) {
    return 'Password must include a lowercase letter';
  }
  if (!/\d/.test(password)) {
    return 'Password must include a number';
  }
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
    return 'Password must include a special character';
  }
  return null;
};

const setAuthCookie = (res: Response, token: string): void => {
  res.cookie(config.authCookie.name, token, {
    httpOnly: true,
    secure: config.authCookie.secure,
    sameSite: config.authCookie.sameSite,
    maxAge: config.authCookie.maxAgeMs,
    path: '/',
  });
};

const establishSession = (res: Response, token: string): void => {
  setAuthCookie(res, token);
  setCsrfCookie(res, createCsrfToken());
};

const clearAuthCookie = (res: Response): void => {
  res.clearCookie(config.authCookie.name, {
    httpOnly: true,
    secure: config.authCookie.secure,
    sameSite: config.authCookie.sameSite,
    path: '/',
  });
};

/**
 * Sign up a new user
 * POST /api/v1/auth/signup
 */
export const signup = async (req: Request<ParamsDictionary, unknown, SignupRequest>, res: Response): Promise<void> => {
  try {
    const { fullName, email, password } = req.body;

    // Validation
    if (!fullName || !email || !password) {
      sendError(res, 400, 'Missing required fields: fullName, email, password');
      return;
    }

    const passwordError = validatePasswordStrength(password);
    if (passwordError) {
      sendError(res, 400, passwordError);
      return;
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      sendError(res, 400, 'Invalid email format');
      return;
    }

    // Register user
    const user = await userService.registerUser(fullName, email, password);

    if (!user) {
      sendError(res, 400, 'User registration failed');
      return;
    }

    // Generate token
    const token = tokenService.generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    establishSession(res, token);
    const publicUser = userService.getPublicUser(user);

    sendSuccess(res, 201, 'User registered successfully', {
      user: publicUser,
    });

    logger.info('User signup successful', { email: user.email });
    await auditLogService.createLog({
      userId: user.id,
      action: 'AUTH_SIGNUP',
      status: 'SUCCESS',
      ipAddress: req.ip,
      metadata: { email: user.email },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'User registration failed';
    logger.error('Signup error', error);
    sendError(res, 400, errorMessage);
  }
};

/**
 * Login user
 * POST /api/v1/auth/login
 */
export const login = async (req: Request<ParamsDictionary, unknown, LoginRequest>, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      sendError(res, 400, 'Missing required fields: email, password');
      return;
    }

    // Authenticate user
    const user = await userService.authenticateUser(email, password);

    if (!user) {
      logger.warn('Login failed - invalid credentials', { email });
      await auditLogService.createLog({
        action: 'AUTH_LOGIN',
        status: 'FAILURE',
        ipAddress: req.ip,
        metadata: { email, reason: 'invalid_credentials' },
      });
      sendError(res, 401, 'Invalid email or password');
      return;
    }

    // Generate token
    const token = tokenService.generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    establishSession(res, token);
    const publicUser = userService.getPublicUser(user);

    sendSuccess(res, 200, 'Login successful', {
      user: publicUser,
    });

    logger.info('User login successful', { email: user.email });
    await auditLogService.createLog({
      userId: user.id,
      action: 'AUTH_LOGIN',
      status: 'SUCCESS',
      ipAddress: req.ip,
      metadata: { email: user.email },
    });
  } catch (error) {
    logger.error('Login error', error);
    sendError(res, 500, 'Login failed');
  }
};

/**
 * Verify token
 * GET /api/v1/auth/verify
 */
export const verifyToken = (req: Request, res: Response): void => {
  try {
    const authHeader = req.headers['authorization'];
    const bearerToken = authHeader && authHeader.split(' ')[1];
    const token = getCookieValue(req, config.authCookie.name) || bearerToken;

    if (!token) {
      sendError(res, 401, 'No token provided');
      return;
    }

    const payload = tokenService.verifyToken(token);

    if (!payload) {
      sendError(res, 401, 'Invalid or expired token');
      return;
    }

    if (!getCookieValue(req, csrfCookieName)) {
      setCsrfCookie(res, createCsrfToken());
    }

    sendSuccess(res, 200, 'Token is valid', {
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
    });
  } catch (error) {
    logger.error('Token verification error', error);
    sendError(res, 500, 'Token verification failed');
  }
};

/**
 * Logout user
 * POST /api/v1/auth/logout
 */
export const logout = (_req: Request, res: Response): void => {
  const authHeader = _req.headers.authorization;
  const bearerToken = authHeader && authHeader.split(' ')[1];
  const cookieToken = getCookieValue(_req, config.authCookie.name);
  if (cookieToken) tokenService.revokeToken(cookieToken);
  if (bearerToken) tokenService.revokeToken(bearerToken);
  clearAuthCookie(res);
  clearCsrfCookie(res);
  sendSuccess(res, 200, 'Logout successful');
};
