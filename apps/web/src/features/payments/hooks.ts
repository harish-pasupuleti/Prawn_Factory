import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAction } from '../../lib/mutations';
import type { Paged, PaymentRow, PaymentState } from '../../lib/types';

const KEYS = ['payments', 'stats'] as const;
const post = <T,>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body }).then((r) => r.data);

export function usePayments(params: { page?: number; pageSize?: number; state?: PaymentState | undefined; requestId?: string | undefined }, enabled = true) {
  return useQuery({
    queryKey: ['payments', 'list', params],
    queryFn: async (): Promise<Paged<PaymentRow>> => {
      const res = await api<PaymentRow[]>('/payments', { query: { page: params.page ?? 1, pageSize: params.pageSize ?? 20, state: params.state, requestId: params.requestId } });
      return { items: res.data, meta: res.meta! };
    },
    placeholderData: keepPreviousData,
    enabled,
  });
}

export const usePayment = (shipmentId: string) =>
  useQuery({ queryKey: ['payments', 'detail', shipmentId], queryFn: async () => (await api<PaymentRow>(`/payments/${shipmentId}`)).data });

const act = <TInput,>(fn: (input: TInput) => Promise<PaymentRow>) => useAction(fn, KEYS, 'payments', (d) => d.shipmentId);

export const useDecidePayment = (shipmentId: string) =>
  act((input: { option: 'PAY_NOW' | 'PAY_LATER'; method?: string; reference?: string }) => post<PaymentRow>(`/payments/${shipmentId}/decide`, input));
export const useSettlePayment = (shipmentId: string) =>
  act((input: { method?: string; reference?: string }) => post<PaymentRow>(`/payments/${shipmentId}/settle`, input));
