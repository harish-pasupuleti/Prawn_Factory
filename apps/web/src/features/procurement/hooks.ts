import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAction } from '../../lib/mutations';
import type { AmendableField, Paged, ProcurementRequest, ProcurementStatus, RequestStats, RequestSummary } from '../../lib/types';

export interface RequestListParams {
  page?: number;
  pageSize?: number;
  status?: ProcurementStatus | '';
  q?: string;
  sort?: 'createdAt' | 'code' | 'status';
  order?: 'asc' | 'desc';
}

export function useRequests(params: RequestListParams) {
  return useQuery({
    queryKey: ['requests', 'list', params],
    queryFn: async (): Promise<Paged<RequestSummary>> => {
      const res = await api<RequestSummary[]>('/procurement', { query: { ...params } });
      return { items: res.data, meta: res.meta! };
    },
    placeholderData: keepPreviousData,
  });
}

export function useRequest(id: string | undefined) {
  return useQuery({
    queryKey: ['requests', 'detail', id],
    enabled: Boolean(id),
    queryFn: async () => (await api<ProcurementRequest>(`/procurement/${id}`)).data,
  });
}

export function useRequestStats() {
  return useQuery({
    queryKey: ['stats', 'requests'],
    queryFn: async () => (await api<RequestStats>('/procurement/stats')).data,
  });
}

const REQUEST_KEYS = ['requests', 'stats', 'inspections', 'collections'] as const;

function useInvalidatingMutation<TInput>(fn: (input: TInput) => Promise<ProcurementRequest>) {
  return useAction(fn, REQUEST_KEYS, 'requests');
}

export interface NewRequestInput {
  species: string;
  declaredSizeCount: string;
  declaredQuantityKg: string;
  expectedPriceInrPerKg: string;
  availabilityDate: string;
  notes?: string;
}

export const useSubmitRequest = () =>
  useInvalidatingMutation((input: NewRequestInput) => api<ProcurementRequest>('/procurement', { method: 'POST', body: input }).then((r) => r.data));

export const useDecision = (id: string) =>
  useInvalidatingMutation((input: { decision: 'APPROVE' | 'REJECT' | 'REQUEST_CLARIFICATION'; reason?: string }) =>
    api<ProcurementRequest>(`/procurement/${id}/decision`, { method: 'POST', body: input }).then((r) => r.data),
  );

export const useCancel = (id: string) =>
  useInvalidatingMutation((input: { reason: string }) =>
    api<ProcurementRequest>(`/procurement/${id}/cancel`, { method: 'POST', body: input }).then((r) => r.data),
  );

export const useResubmit = (id: string) =>
  useInvalidatingMutation((input: { note?: string }) =>
    api<ProcurementRequest>(`/procurement/${id}/resubmit`, { method: 'POST', body: input }).then((r) => r.data),
  );

export const useAmend = (id: string) =>
  useInvalidatingMutation((input: { field: AmendableField; newValue: string; reason: string }) =>
    api<ProcurementRequest>(`/procurement/${id}/amendments`, { method: 'POST', body: input }).then((r) => r.data),
  );
