import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Do not hammer the API on client errors (400-499); retry transient failures twice.
      retry: (failureCount, error) =>
        error instanceof ApiError && error.status >= 400 && error.status < 500 ? false : failureCount < 2,
    },
  },
});
