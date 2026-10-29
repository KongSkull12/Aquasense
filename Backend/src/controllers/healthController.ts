import { Request, Response } from 'express';
import { SuccessResponse } from '../types';

/**
 * Health check controller
 */
export const healthCheck = (_req: Request, res: Response): void => {
  const response: SuccessResponse = {
    success: true,
    statusCode: 200,
    message: 'Server is running',
    data: {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
    },
  };

  res.status(200).json(response);
};
