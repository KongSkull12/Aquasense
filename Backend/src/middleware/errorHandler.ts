import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { ApiResponse } from '../types';

/**
 * Global error handling middleware
 */
export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  logger.error('Request Error', {
    message: err.message,
    stack: err.stack,
    timestamp: new Date().toISOString(),
  });

  const isDevelopment = process.env.NODE_ENV === 'development';

  // Determine appropriate status code
  let statusCode = 500;
  let message = 'Internal server error';

  // Handle specific error types
  if (err.message.includes('validation')) {
    statusCode = 400;
    message = 'Validation error';
  } else if (err.message.includes('unauthorized')) {
    statusCode = 401;
    message = 'Unauthorized';
  } else if (err.message.includes('not found')) {
    statusCode = 404;
    message = 'Resource not found';
  } else if (err.message.includes('duplicate')) {
    statusCode = 409;
    message = 'Resource already exists';
  }

  const response: ApiResponse = {
    success: false,
    statusCode,
    message,
    error: isDevelopment ? err.message : 'An error occurred processing your request',
  };

  res.status(statusCode).json(response);
};

/**
 * 404 Not Found middleware
 */
export const notFoundHandler = (req: Request, res: Response): void => {
  const response: ApiResponse = {
    success: false,
    statusCode: 404,
    message: 'Resource not found',
    error: `Cannot ${req.method} ${req.originalUrl}`,
  };

  res.status(404).json(response);
};
