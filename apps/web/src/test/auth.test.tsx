import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequireAuth } from '../auth/RequireAuth';
import { navItemsFor } from '../components/Layout';
import { setAccessToken } from '../lib/api';
import { ROLES } from '../lib/types';
import { LoginPage } from '../pages/AuthPages';
import { farmerUser, json, mockFetch, renderApp } from './utils';

const unauthenticated = (url: string) => (url.endsWith('/auth/refresh') ? json(401, { error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }) : undefined);

describe('LoginPage', () => {
  beforeEach(() => setAccessToken(null));
  afterEach(() => vi.unstubAllGlobals());

  it('shows field errors and does not call the API when the form is empty', async () => {
    const fetchFn = mockFetch((url) => unauthenticated(url) ?? json(500));
    renderApp(<LoginPage />, { route: '/login' });
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(fetchFn.mock.calls.some(([u]) => String(u).endsWith('/auth/login'))).toBe(false);
  });

  it('shows the generic server message for bad credentials', async () => {
    mockFetch((url) => unauthenticated(url) ?? json(401, { error: { code: 'UNAUTHENTICATED', message: 'Invalid email or password' } }));
    renderApp(<LoginPage />, { route: '/login' });
    await userEvent.type(await screen.findByLabelText('Email'), 'farmer@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });

  it('signs in and moves to the app', async () => {
    mockFetch((url) => unauthenticated(url) ?? json(200, { data: { accessToken: 'tok', expiresIn: 900, user: farmerUser } }));
    renderApp(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<p>Home screen</p>} />
      </Routes>,
      { route: '/login' },
    );
    await userEvent.type(await screen.findByLabelText('Email'), 'farmer@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'a-good-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Home screen')).toBeInTheDocument();
  });
});

describe('route protection and navigation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('redirects anonymous visitors to the login page', async () => {
    mockFetch((url) => unauthenticated(url) ?? json(500));
    renderApp(
      <Routes>
        <Route path="/login" element={<p>Login screen</p>} />
        <Route element={<RequireAuth />}>
          <Route path="/secret" element={<p>Secret</p>} />
        </Route>
      </Routes>,
      { route: '/secret' },
    );
    expect(await screen.findByText('Login screen')).toBeInTheDocument();
    expect(screen.queryByText('Secret')).not.toBeInTheDocument();
  });

  it('sends users without the right role to the forbidden page', async () => {
    mockFetch(() => json(200, { data: { accessToken: 't', user: farmerUser } }));
    renderApp(
      <Routes>
        <Route path="/forbidden" element={<p>Forbidden screen</p>} />
        <Route element={<RequireAuth roles={['ADMIN']} />}>
          <Route path="/users" element={<p>Users admin</p>} />
        </Route>
      </Routes>,
      { route: '/users' },
    );
    await waitFor(() => expect(screen.getByText('Forbidden screen')).toBeInTheDocument());
    expect(screen.queryByText('Users admin')).not.toBeInTheDocument();
  });

  it('offers each role only its own navigation', () => {
    const labels = (role: (typeof ROLES)[number]) => navItemsFor(role).map((i) => i.label);
    expect(labels('FARMER')).toEqual(['Dashboard', 'My requests', 'New request']);
    expect(labels('PURCHASE_MANAGER')).toEqual([
      'Dashboard', 'Procurement requests', 'Inspections', 'Collections', 'Arrival schedule', 'Shipments', 'Processing queue', 'Exceptions', 'Slots',
    ]);
    expect(labels('SECURITY_OFFICER')).toEqual(['Dashboard', 'Gate']);
    expect(labels('FACTORY_OPERATOR')).toEqual(['Dashboard', 'Shipments', 'Processing queue']);
    expect(labels('FIELD_OFFICER')).toEqual(['Dashboard', 'My inspections']);
    expect(labels('TRANSPORT_OFFICER')).toEqual(['Dashboard', 'My collections']);
    expect(labels('ADMIN')).toEqual([
      'Dashboard', 'Procurement requests', 'Inspections', 'Collections', 'Arrival schedule', 'Shipments', 'Processing queue', 'Exceptions',
      'Slots & stations', 'Vehicles', 'Users',
    ]);
    for (const role of ROLES.filter((r) => r !== 'ADMIN')) {
      expect(labels(role)).not.toContain('Users');
      expect(labels(role)).not.toContain('Vehicles');
    }
    // Only security sees the gate; only the operator, manager and administrator see shipments and the queue.
    expect(ROLES.filter((r) => labels(r).includes('Gate'))).toEqual(['SECURITY_OFFICER']);
    expect(ROLES.filter((r) => labels(r).includes('Processing queue'))).toEqual(['PURCHASE_MANAGER', 'FACTORY_OPERATOR', 'ADMIN']);
    expect(labels('FARMER')).not.toContain('Shipments');
    // Only the purchase manager and administrator can see every inspection or collection.
    expect(labels('FARMER')).not.toContain('Inspections');
    expect(labels('FIELD_OFFICER')).not.toContain('Collections');
  });
});
