import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewRequestPage } from '../pages/NewRequestPage';
import { json, mockFetch, renderApp } from './utils';

const page = () =>
  renderApp(
    <Routes>
      <Route path="/requests/new" element={<NewRequestPage />} />
      <Route path="/requests/:id" element={<p>Request detail screen</p>} />
    </Routes>,
    { route: '/requests/new', withAuth: false },
  );

describe('NewRequestPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows validation errors and does not submit invalid data', async () => {
    const fetchFn = mockFetch(() => json(500));
    page();
    await userEvent.type(screen.getByLabelText('Estimated quantity (kg)'), '-5');
    await userEvent.type(screen.getByLabelText('Expected price (₹ per kg)'), 'free');
    await userEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(await screen.findByText('Species is required')).toBeInTheDocument();
    expect(screen.getByText(/Quantity must be a number with at most 3 decimal places/)).toBeInTheDocument();
    expect(screen.getByText(/Price must be a number with at most 2 decimal places/)).toBeInTheDocument();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('submits exact decimal strings and opens the created request', async () => {
    const fetchFn = mockFetch(() => json(201, { data: { id: 'new-id', code: 'PR-2026-000001' } }));
    page();
    await userEvent.type(screen.getByLabelText('Species'), 'Vannamei');
    await userEvent.type(screen.getByLabelText('Declared size / count'), '30-40 count per kg');
    await userEvent.type(screen.getByLabelText('Estimated quantity (kg)'), '1250.5');
    await userEvent.type(screen.getByLabelText('Expected price (₹ per kg)'), '420');
    fireEvent.change(screen.getByLabelText('Availability date'), { target: { value: '2099-01-15' } });
    await userEvent.click(screen.getByRole('button', { name: 'Submit request' }));

    expect(await screen.findByText('Request detail screen')).toBeInTheDocument();
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe('/api/v1/procurement');
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      species: 'Vannamei',
      declaredQuantityKg: '1250.5',
      expectedPriceInrPerKg: '420',
      availabilityDate: '2099-01-15',
    });
  });

  it('shows a duplicate-request error from the server without navigating away', async () => {
    mockFetch(() => json(409, { error: { code: 'DUPLICATE_REQUEST', message: 'You already have an open request with identical details' } }));
    page();
    await userEvent.type(screen.getByLabelText('Species'), 'Vannamei');
    await userEvent.type(screen.getByLabelText('Declared size / count'), '30-40');
    await userEvent.type(screen.getByLabelText('Estimated quantity (kg)'), '100');
    await userEvent.type(screen.getByLabelText('Expected price (₹ per kg)'), '400');
    fireEvent.change(screen.getByLabelText('Availability date'), { target: { value: '2099-01-15' } });
    await userEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('identical details');
    expect(screen.queryByText('Request detail screen')).not.toBeInTheDocument();
  });
});
