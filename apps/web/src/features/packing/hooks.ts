import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAction } from '../../lib/mutations';
import type { BoxPlanLine, Paged, PackingDetail, PackingListItem } from '../../lib/types';

const KEYS = ['packing', 'boxPlan'] as const;
const post = <T,>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body }).then((r) => r.data);

const act = <TInput,>(fn: (input: TInput) => Promise<PackingDetail>) => useAction(fn, KEYS, 'packing', (d) => d.shipment.id);

export function usePackingList(params: { page: number; state?: 'open' | 'approved' | undefined }) {
  return useQuery({
    queryKey: ['packing', 'list', params],
    queryFn: async (): Promise<Paged<PackingListItem>> => {
      const res = await api<PackingListItem[]>('/packing', { query: { page: params.page, pageSize: 20, state: params.state } });
      return { items: res.data, meta: res.meta! };
    },
    placeholderData: keepPreviousData,
  });
}

export const usePacking = (shipmentId: string) =>
  useQuery({ queryKey: ['packing', 'detail', shipmentId], queryFn: async () => (await api<PackingDetail>(`/packing/${shipmentId}`)).data });

export const useBoxPlan = (requestId: string, enabled = true) =>
  useQuery({ queryKey: ['boxPlan', requestId], queryFn: async () => (await api<BoxPlanLine[]>(`/packing/plans/${requestId}`)).data, enabled });

export const useSetBoxPlan = (requestId: string) =>
  useAction(
    (lines: { form: string; sizeGrade: string; boxWeightKg: string; quantity: number }[]) =>
      api<BoxPlanLine[]>(`/packing/plans/${requestId}`, { method: 'PUT', body: { lines } }).then((r) => r.data),
    KEYS,
  );

export const useAddBoxes = (shipmentId: string) =>
  act((input: { requirementId: string; netWeightKg: string; count: number }) => post<PackingDetail>(`/packing/${shipmentId}/boxes`, input));
export const useAssignBoxIds = (shipmentId: string) => act(() => post<PackingDetail>(`/packing/${shipmentId}/assign-ids`));
export const useVoidBox = (shipmentId: string) =>
  act(({ boxId, reason }: { boxId: string; reason: string }) => post<PackingDetail>(`/packing/${shipmentId}/boxes/${boxId}/void`, { reason }));
export const useApprovePacking = (shipmentId: string) =>
  act((input: { note?: string }) => post<PackingDetail>(`/packing/${shipmentId}/approve`, input));
