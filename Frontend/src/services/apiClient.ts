import axios, { AxiosError, AxiosInstance } from 'axios';
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
      const csrfToken = this.getCookieValue('aquasense_csrf');
      if (csrfToken && ['post', 'put', 'patch', 'delete'].includes((config.method || '').toLowerCase())) {
        config.headers['X-CSRF-Token'] = csrfToken;
      }
      return config;
    });

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        // Handle errors globally
        if (error.response?.status === 401) {
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

  async post<T = unknown>(url: string, data?: unknown): Promise<SuccessResponse<T>> {
    const response = await this.client.post<ApiResponse<T>>(url, data);
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
      await this.get('/auth/verify');
      return true;
    } catch {
      return false;
    }
  }

  async logout(): Promise<void> {
    await this.post('/auth/logout');
    localStorage.removeItem('user');
  }
}

export const apiClient = new ApiClient();
