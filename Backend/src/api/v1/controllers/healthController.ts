import { Request, Response } from 'express';
import { SuccessResponse } from '../../../types';

/**
 * Health check controller for API v1
 */
export const healthCheck = (_req: Request, res: Response): void => {
  const response: SuccessResponse = {
    success: true,
    statusCode: 200,
    message: 'API v1 is healthy',
    data: {
      version: 'v1',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    },
  };

  res.status(200).json(response);
};
