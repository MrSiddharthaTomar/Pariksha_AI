/**
 * API Configuration
 * Centralized configuration for API endpoints
 * Uses environment variables for cloud deployment compatibility
 */

const getApiBaseUrl = (): string => {
  // In development, use VITE_API_BASE_URL from .env
  // In production, this will be set by the deployment platform
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  
  if (!apiBaseUrl) {
    // Fallback to default local development URL
    console.warn('VITE_API_BASE_URL not set in .env file. Using default: http://localhost:3000');
    return 'http://localhost:3000';
  }
  
  // Ensure the URL doesn't end with a slash and trim whitespace
  return apiBaseUrl.trim().replace(/\/$/, '');
};

export const API_BASE_URL = getApiBaseUrl();

/**
 * Constructs a full API endpoint URL
 * @param endpoint - API endpoint path (e.g., '/auth/examiner/login')
 * @returns Full URL to the API endpoint
 */
export const getApiUrl = (endpoint: string): string => {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${API_BASE_URL}${cleanEndpoint}`;
};

export const getToken = (): string | null => {
  return localStorage.getItem('token');
};

export const getAuthHeaders = (extraHeaders: Record<string, string> = {}) => {
  const token = getToken();
  const headers: Record<string, string> = { ...extraHeaders };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
};

const DEFAULT_TIMEOUT_MS = Number(import.meta.env.VITE_FETCH_TIMEOUT_MS || 10000);
const RETRY_DELAY_MS = Number(import.meta.env.VITE_FETCH_RETRY_DELAY_MS || 700);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchWithTimeout = async (url: string, options: RequestInit, timeoutMs: number) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
};

const shouldRetry = (method: string, error: unknown, status?: number) => {
  // Retry only safe reads by default.
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (typeof status === 'number') return status >= 502 || status === 408 || status === 429;

  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof TypeError) return true; // network failures
  return false;
};

export const authFetch = async (url: string, options: RequestInit = {}) => {
  const method = (options.method || 'GET').toUpperCase();
  const headers = { ...(options.headers || {}), ...getAuthHeaders() } as Record<string, string>;
  const opts: RequestInit = { ...options, headers };

  try {
    const response = await fetchWithTimeout(url, opts, DEFAULT_TIMEOUT_MS);
    if (shouldRetry(method, null, response.status)) {
      await sleep(RETRY_DELAY_MS);
      return fetchWithTimeout(url, opts, DEFAULT_TIMEOUT_MS);
    }
    return response;
  } catch (error) {
    if (shouldRetry(method, error)) {
      await sleep(RETRY_DELAY_MS);
      return fetchWithTimeout(url, opts, DEFAULT_TIMEOUT_MS);
    }
    throw error;
  }
};

export const getImageUrl = (imageId?: string | null) => {
  if (!imageId) return '';
  const token = getToken();
  const base = getApiUrl(`/api/examiner/proctoring/images/${imageId}`);
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
};

