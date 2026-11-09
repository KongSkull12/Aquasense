/**
 * Response utility for consistent API responses
 */
import { Response } from 'express';
import { SuccessResponse, ErrorResponse } from '../types';

export const sendSuccess = <T = unknown>(
  res: Response,
  statusCode: number,
  message: string,
  data?: T
): Response => {
  const response: SuccessResponse<T | undefined> = {
    success: true,
    statusCode,
    message,
    data,
  };
  return res.status(statusCode).json(response);
};

export const sendError = (
  res: Response,
  statusCode: number,
  message: string,
  error?: string | Record<string, unknown>
): Response => {
  const response: ErrorResponse = {
    success: false,
    statusCode,
    message,
    error: error || message,
  };
  return res.status(statusCode).json(response);
};
