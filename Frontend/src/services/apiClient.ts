import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import type { ApiResponse, SuccessResponse } from '../types/api';
import { API_BASE_URL } from '../config/runtime';

export const getApiErrorMessage = (error: unknown, fallback: string): string => {
  if (!axios.isAxiosError<ApiResponse>(error)) {
    return fallback;
  }

  if (error.response?.data?.message) {
    return error.response.data.message;
  }

  if (error.code === 'ECONNABORTED') {
    return 'The server took too long to respond. Please try again.';
  }

  if (!error.response) {
    return 'Cannot connect to the AquaSense server. Make sure the backend is running.';
  }

  return fallback;
};

/**
 * API client for backend communication
 */
class ApiClient {
  private client: AxiosInstance;
  private baseURL: string;
  // The backend also returns the CSRF token in auth responses; on another domain the cookie is unreadable.
  private csrfToken: string | null = null;

  constructor() {
    this.baseURL = API_BASE_URL;
    this.client = axios.create({
      baseURL: this.baseURL,
      withCredentials: true,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    this.client.interceptors.request.use((config) => {
      const csrfToken = this.getCookieValue('aquasense_csrf') || this.csrfToken;
      if (csrfToken && ['post', 'put', 'patch', 'delete'].includes((config.method || '').toLowerCase())) {
        config.headers['X-CSRF-Token'] = csrfToken;
      }
      return config;
    });

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => {
        const token = (response.data as { data?: { csrfToken?: unknown } } | undefined)?.data?.csrfToken;
        if (typeof token === 'string' && token) this.csrfToken = token;
        return response;
      },
      async (error: AxiosError<ApiResponse>) => {
        // The in-memory CSRF token is lost on a page reload. Fetch it from the session once and retry.
        const request = error.config as (InternalAxiosRequestConfig & { csrfRetried?: boolean }) | undefined;
        if (error.response?.status === 403 && /csrf/i.test(error.response.data?.message || '') &&
            request && !request.csrfRetried) {
          request.csrfRetried = true;
          this.csrfToken = null;
          try {
            await this.client.get('/auth/verify');
          } catch {
            return Promise.reject(error);
          }
          return this.client.request(request);
        }

        // Handle errors globally
        if (error.response?.status === 401) {
          this.csrfToken = null;
          localStorage.removeItem('user');
        }
        return Promise.reject(error);
      }
    );
  }

  async get<T = unknown>(url: string): Promise<SuccessResponse<T>> {
    const response = await this.client.get<ApiResponse<T>>(url);
    return response.data as SuccessResponse<T>;
  }

  async post<T = unknown>(url: string, data?: unknown, timeout?: number): Promise<SuccessResponse<T>> {
    const response = await this.client.post<ApiResponse<T>>(url, data, timeout ? { timeout } : undefined);
    return response.data as SuccessResponse<T>;
  }

  async put<T = unknown>(url: string, data?: unknown): Promise<SuccessResponse<T>> {
    const response = await this.client.put<ApiResponse<T>>(url, data);
    return response.data as SuccessResponse<T>;
  }

  async delete<T = unknown>(url: string): Promise<SuccessResponse<T>> {
    const response = await this.client.delete<ApiResponse<T>>(url);
    return response.data as SuccessResponse<T>;
  }

  private getCookieValue(name: string): string | null {
    const cookie = document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`));

    return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : null;
  }

  async verifyAuth(): Promise<boolean> {
    try {
      const response = await this.get<{ userId?: string; email?: string; role?: string; fullName?: string }>('/auth/verify');
      // Keep role and email so staff nav and settings stay accurate after refresh.
      if (response.data?.email || response.data?.role) {
        const existing = (() => {
          try { return JSON.parse(localStorage.getItem('user') || '{}') as Record<string, unknown>; }
          catch { return {}; }
        })();
        localStorage.setItem('user', JSON.stringify({
          ...existing,
          id: response.data.userId || existing.id,
          email: response.data.email || existing.email,
          fullName: response.data.fullName || existing.fullName,
          role: response.data.role || existing.role,
        }));
      }
      return true;
    } catch {
      return false;
    }
  }

  async logout(): Promise<void> {
    try {
      await this.post('/auth/logout');
    } finally {
      this.csrfToken = null;
      localStorage.removeItem('user');
    }
  }
}

export const apiClient = new ApiClient();
