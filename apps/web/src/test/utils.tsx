import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';

export const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const farmerUser = {
  id: 'u1',
  email: 'farmer@example.com',
  fullName: 'Ravi Kumar',
  role: 'FARMER' as const,
  status: 'ACTIVE' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
};

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

/** Replaces global fetch. Unmatched requests fail loudly so tests never hit a real network. */
export function mockFetch(handler: Handler) {
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => handler(String(input), init));
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function renderApp(ui: ReactElement, { route = '/', withAuth = true }: { route?: string; withAuth?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const tree = (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{withAuth ? <AuthProvider>{ui}</AuthProvider> : ui}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(tree);
}

type RouteHandler = (init: RequestInit) => Response;

/** Signed-in session plus a routing table keyed by "METHOD /path". A key without a query string matches any query. */
export function signedInApi(role: import('../lib/types').Role, routes: Record<string, RouteHandler>) {
  return mockFetch((url, init) => {
    const method = (init.method ?? 'GET').toUpperCase();
    if (url.endsWith('/auth/refresh')) return json(200, { data: { accessToken: 't', user: { id: `u-${role}`, email: 'x@example.com', fullName: 'Test User', role, status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z' } } });
    const path = url.replace('/api/v1', '');
    const handler = routes[`${method} ${path}`] ?? routes[`${method} ${path.split('?')[0]}`];
    if (!handler) throw new Error(`Unexpected request: ${method} ${path}`);
    return handler(init);
  });
}

/** Parsed JSON bodies of every POST whose URL ends with `suffix`. */
export function postBodies(fn: ReturnType<typeof mockFetch>, suffix: string): unknown[] {
  return fn.mock.calls
    .filter(([u, i]) => String(u).split('?')[0]!.endsWith(suffix) && (i as RequestInit | undefined)?.method === 'POST')
    .map(([, i]) => JSON.parse(String((i as RequestInit).body ?? '{}')));
}
