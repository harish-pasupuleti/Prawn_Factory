import type { PageMeta, User } from './types';

const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: { path: string; message: string }[],
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The access token lives only in memory. It is never written to localStorage or sessionStorage. */
let accessToken: string | null = null;
export const getAccessToken = () => accessToken;
export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

/** Called when a session cannot be refreshed, so the UI can return to the login page. */
let onSessionExpired: (() => void) | null = null;
export const setSessionExpiredHandler = (handler: (() => void) | null) => {
  onSessionExpired = handler;
};

interface SessionPayload {
  accessToken: string;
  user: User;
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON body
  }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string; details?: ApiError['details']; requestId?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'UNKNOWN_ERROR', err?.message ?? 'Request failed', err?.details, err?.requestId);
  }
  return body as T;
}

/**
 * Single-flight refresh: refresh tokens are single-use, so concurrent callers (including React
 * StrictMode's double effects) must share one request or the server would see token reuse.
 */
let inflightRefresh: Promise<SessionPayload | null> | null = null;

export function refreshSession(): Promise<SessionPayload | null> {
  inflightRefresh ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin',
      });
      if (!res.ok) {
        setAccessToken(null);
        return null;
      }
      const { data } = (await res.json()) as { data: SessionPayload };
      setAccessToken(data.accessToken);
      return data;
    } catch {
      setAccessToken(null);
      return null;
    } finally {
      inflightRefresh = null;
    }
  })();
  return inflightRefresh;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Internal: allow exactly one retry after a token refresh. */
  retry?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return `${BASE}${path}${qs ? `?${qs}` : ''}`;
}

async function send(path: string, opts: RequestOptions, authenticated: boolean): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (authenticated && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return fetch(buildUrl(path, opts.query), {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
}

/** Authenticated JSON request. Retries once after refreshing the access token on 401. */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<{ data: T; meta?: PageMeta }> {
  let res = await send(path, opts, true);
  if (res.status === 401 && opts.retry !== false) {
    const session = await refreshSession();
    if (!session) {
      onSessionExpired?.();
      return parse(res);
    }
    res = await send(path, { ...opts, retry: false }, true);
  }
  return parse(res);
}

/** Unauthenticated JSON request (login, register). */
export async function publicApi<T>(path: string, body: unknown): Promise<{ data: T }> {
  const res = await send(path, { method: 'POST', body }, false);
  return parse(res);
}

export async function logoutRequest(): Promise<void> {
  try {
    await fetch(`${BASE}/auth/logout`, {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    });
  } finally {
    setAccessToken(null);
  }
}
