import { NextFunction, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { config } from '../config/config';
import { sendError } from '../utils/response';

export const csrfCookieName = 'aquasense_csrf';
export const csrfHeaderName = 'x-csrf-token';

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const createCsrfToken = (): string => randomBytes(32).toString('hex');

export const getCookieValue = (req: Request, name: string): string | undefined => {
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

export const setCsrfCookie = (res: Response, token: string): void => {
  res.cookie(csrfCookieName, token, {
    httpOnly: false,
    secure: config.authCookie.secure,
    sameSite: config.authCookie.sameSite,
    maxAge: config.authCookie.maxAgeMs,
    path: '/',
  });
};

export const clearCsrfCookie = (res: Response): void => {
  res.clearCookie(csrfCookieName, {
    secure: config.authCookie.secure,
    sameSite: config.authCookie.sameSite,
    path: '/',
  });
};

export const csrfProtection = (req: Request, res: Response, next: NextFunction): void => {
  if (!unsafeMethods.has(req.method)) {
    next();
    return;
  }

  const authCookie = getCookieValue(req, config.authCookie.name);
  if (!authCookie) {
    next();
    return;
  }

  const csrfCookie = getCookieValue(req, csrfCookieName);
  const csrfHeader = req.headers[csrfHeaderName];
  const csrfToken = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;

  if (!csrfCookie || !csrfToken || csrfCookie !== csrfToken) {
    sendError(res, 403, 'CSRF token validation failed');
    return;
  }

  next();
};
