/**
 * Custom hook for fetching data
 */
import { useState, useEffect } from 'react';
import { apiClient } from '@services/apiClient';

interface UseApiOptions {
  skip?: boolean;
  onError?: (error: Error) => void;
  onSuccess?: (data: unknown) => void;
}

export function useApi<T = unknown>(
  url: string,
  options?: UseApiOptions
): {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!options?.skip);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = async (): Promise<void> => {
    if (options?.skip) return;

    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.get<T>(url);
      setData(response.data || null);
      options?.onSuccess?.(response.data);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      setError(error);
      options?.onError?.(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [url, options?.skip]);

  return { data, loading, error, refetch: fetchData };
}
