/**
 * Authentication Middleware - Verifies JWT tokens on protected routes
 */
import { Request, Response, NextFunction } from 'express';
import { tokenService } from '../utils/tokenService';
import { sendError } from '../utils/response';
import { logger } from '../utils/logger';
import { config } from '../config/config';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userEmail?: string;
  userRole?: 'admin' | 'farmer' | 'guest';
}

const getCookieValue = (req: Request, name: string): string | undefined => {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) {
    return undefined;
  }

  const cookie = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));

  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : undefined;
};

const getAuthToken = (req: Request): string | undefined => {
  const authHeader = req.headers['authorization'];
  const bearerToken = authHeader && authHeader.split(' ')[1];
  return getCookieValue(req, config.authCookie.name) || bearerToken;
};

/**
 * Middleware to verify JWT token
 */
export const authenticateToken = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  try {
    const token = getAuthToken(req);

    if (!token) {
      logger.debug('No token provided');
      sendError(res, 401, 'No authentication token provided');
      return;
    }

    const payload = tokenService.verifyToken(token);

    if (!payload) {
      logger.debug('Invalid or expired token');
      sendError(res, 401, 'Invalid or expired token');
      return;
    }

    req.userId = payload.userId;
    req.userEmail = payload.email;
    req.userRole = payload.role || 'farmer';
    logger.debug('Token verified', { userId: payload.userId });
    next();
  } catch (error) {
    logger.error('Authentication middleware error', error);
    sendError(res, 500, 'Authentication failed');
  }
};

/**
 * Middleware to check if user is authenticated (optional)
 */
export const optionalAuth = (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
  try {
    const token = getAuthToken(req);

    if (token) {
      const payload = tokenService.verifyToken(token);
      if (payload) {
        req.userId = payload.userId;
        req.userEmail = payload.email;
        req.userRole = payload.role || 'farmer';
      }
    }
    next();
  } catch (error) {
    next();
  }
};

export default authenticateToken;

export const requireRole = (allowedRoles: Array<'admin' | 'farmer' | 'guest'>) => (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  if (!req.userRole || !allowedRoles.includes(req.userRole)) {
    sendError(res, 403, 'Insufficient permissions');
    return;
  }
  next();
};
