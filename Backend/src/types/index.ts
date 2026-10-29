/**
 * Global type definitions
 */

export interface ApiResponse<T = unknown> {
  success: boolean;
  statusCode: number;
  message: string;
  data?: T;
  error?: string | Record<string, unknown>;
}

export interface ErrorResponse extends ApiResponse {
  success: false;
  error: string | Record<string, unknown>;
}

export interface SuccessResponse<T = unknown> extends ApiResponse<T> {
  success: true;
  data: T;
}

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}
