import { NextFunction, Request, Response } from 'express';
import { config } from '../config/config';
import { sendError } from '../utils/response';

export const requireHttps = (req: Request, res: Response, next: NextFunction): void => {
  if (config.server.nodeEnv !== 'production') {
    next();
    return;
  }

  const forwardedProto = req.headers['x-forwarded-proto'];
  const isHttps = req.secure || forwardedProto === 'https';

  if (!isHttps) {
    sendError(res, 426, 'HTTPS is required');
    return;
  }

  next();
};
