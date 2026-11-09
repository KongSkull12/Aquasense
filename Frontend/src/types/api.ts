/**
 * Global type definitions for the application
 */

export interface ApiResponse<T = unknown> {
  success: boolean;
  statusCode: number;
  message: string;
  data?: T;
  error?: string | Record<string, unknown>;
}

export interface SuccessResponse<T = unknown> extends ApiResponse<T> {
  success: true;
  data: T;
}

export interface ErrorResponse extends ApiResponse {
  success: false;
  error: string | Record<string, unknown>;
}
