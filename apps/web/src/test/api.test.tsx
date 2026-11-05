import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, getAccessToken, refreshSession, setAccessToken, setSessionExpiredHandler } from '../lib/api';
import { farmerUser, json, mockFetch } from './utils';

const authHeader = (init: RequestInit) => (init.headers as Record<string, string> | undefined)?.Authorization;

describe('api client', () => {
  beforeEach(() => setAccessToken(null));
  afterEach(() => {
    vi.unstubAllGlobals();
    setSessionExpiredHandler(null);
  });

  it('sends the in-memory access token as a Bearer header', async () => {
    setAccessToken('tok');
    const fetchFn = mockFetch(() => json(200, { data: { ok: true } }));
    await api('/procurement');
    expect(authHeader(fetchFn.mock.calls[0]![1] as RequestInit)).toBe('Bearer tok');
  });

  it('refreshes once and retries when a request returns 401', async () => {
    setAccessToken('expired');
    const fetchFn = mockFetch((url, init) => {
      if (url.endsWith('/auth/refresh')) return json(200, { data: { accessToken: 'fresh', user: farmerUser } });
      return authHeader(init) === 'Bearer fresh' ? json(200, { data: { ok: true } }) : json(401, { error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
    });
    const res = await api<{ ok: boolean }>('/procurement');
    expect(res.data.ok).toBe(true);
    expect(getAccessToken()).toBe('fresh');
    expect(fetchFn.mock.calls.filter(([u]) => String(u).endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('shares a single refresh between concurrent 401s (refresh tokens are single-use)', async () => {
    setAccessToken('expired');
    let refreshCalls = 0;
    mockFetch(async (url, init) => {
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        await new Promise((r) => setTimeout(r, 20));
        return json(200, { data: { accessToken: 'fresh', user: farmerUser } });
      }
      return authHeader(init) === 'Bearer fresh' ? json(200, { data: { ok: true } }) : json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } });
    });
    await Promise.all([api('/a'), api('/b'), api('/c')]);
    expect(refreshCalls).toBe(1);
  });

  it('shares one refresh between simultaneous session restores (React StrictMode)', async () => {
    let refreshCalls = 0;
    mockFetch(async () => {
      refreshCalls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return json(200, { data: { accessToken: 'a', user: farmerUser } });
    });
    await Promise.all([refreshSession(), refreshSession()]);
    expect(refreshCalls).toBe(1);
  });

  it('signals session expiry and surfaces the error when refresh fails', async () => {
    setAccessToken('expired');
    const expired = vi.fn();
    setSessionExpiredHandler(expired);
    mockFetch(() => json(401, { error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }));
    await expect(api('/procurement')).rejects.toBeInstanceOf(ApiError);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();
  });

  it('exposes API error code, message, details and request id', async () => {
    setAccessToken('t');
    mockFetch(() => json(400, { error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: [{ path: 'species', message: 'bad' }], requestId: 'abc' } }));
    const err = (await api('/procurement', { method: 'POST', body: {} }).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', requestId: 'abc' });
    expect(err.details?.[0]?.path).toBe('species');
  });

  it('never writes tokens to browser storage', async () => {
    mockFetch(() => json(200, { data: { accessToken: 'secret-token', user: farmerUser } }));
    await refreshSession();
    expect(JSON.stringify({ ...localStorage })).not.toContain('secret-token');
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('secret-token');
    expect(document.cookie).not.toContain('secret-token');
  });
});
