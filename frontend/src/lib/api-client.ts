import axios, { type AxiosError } from 'axios';
import type { ApiErrorBody, ApiResponse, Page } from '@/types/api';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1';

export class ApiError extends Error {
  readonly status: number; // 0 = network failure / no response
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get isNetworkError() {
    return this.status === 0;
  }
  /** The endpoint does not exist (yet) on the backend. */
  get isNotImplemented() {
    return this.status === 404 || this.status === 501;
  }
}

// Session lives in an httpOnly cookie set by the backend; the browser never sees the token.
export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  timeout: 15_000,
  headers: { 'X-Requested-With': 'CloudSphere' },
});

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  const part = document.cookie.split('; ').find((item) => item.startsWith(prefix));
  return part ? decodeURIComponent(part.slice(prefix.length)) : null;
}

api.interceptors.request.use((config) => {
  const token = readCookie('cloudsphere_csrf');
  if (token && !['get', 'head', 'options'].includes((config.method ?? 'get').toLowerCase())) {
    config.headers.set('X-CSRF-Token', token);
  }
  return config;
});

export async function ensureCsrf(signal?: AbortSignal): Promise<void> {
  await api.get('/auth/csrf', { signal });
}

let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  unauthorizedHandler = fn;
}

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiErrorBody>) => {
    if (axios.isCancel(error)) return Promise.reject(error);
    const status = error.response?.status ?? 0;
    const body = error.response?.data?.error;
    const apiError = new ApiError(
      status,
      body?.code ?? (status === 0 ? 'NETWORK_ERROR' : `HTTP_${status}`),
      body?.message ??
        (status === 0
          ? 'Cannot reach the CloudSphere API. Check that the backend is running.'
          : `Request failed (HTTP ${status}).`),
      body?.details,
    );
    const isAuthCall = error.config?.url?.startsWith('/auth/') ?? false;
    if (status === 401 && !isAuthCall) unauthorizedHandler?.();
    return Promise.reject(apiError);
  },
);

export async function getData<T>(
  url: string,
  params?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const res = await api.get<ApiResponse<T>>(url, { params, signal });
  return res.data.data;
}

export async function getPage<T>(
  url: string,
  params?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Page<T>> {
  const res = await api.get<ApiResponse<T[]>>(url, { params, signal });
  return {
    items: res.data.data,
    meta: res.data.meta ?? { page: 1, page_size: res.data.data.length, total: res.data.data.length },
  };
}

export async function postData<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await api.post<ApiResponse<T>>(url, body, { signal });
  return res.data.data;
}

export async function patchData<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await api.patch<ApiResponse<T>>(url, body, { signal });
  return res.data.data;
}

export async function deleteData(url: string, signal?: AbortSignal): Promise<void> {
  await api.delete(url, { signal });
}
