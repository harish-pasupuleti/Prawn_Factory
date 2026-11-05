import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAction as useSharedAction } from '../../lib/mutations';
import type {
  Booking, BookingStatus, ExceptionCase, ExceptionStatus, GateAction, Paged, QueueEntry, QueueStatus, Shipment, ShipmentStatus, Slot, Station,
} from '../../lib/types';

const ALL_KEYS = ['requests', 'stats', 'collections', 'slots', 'bookings', 'shipments', 'exceptions', 'stations', 'queue', 'factoryStats'] as const;

const useAction = <TInput, TOutput = unknown>(fn: (input: TInput) => Promise<TOutput>) => useSharedAction(fn, ALL_KEYS);

const post = <T,>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body }).then((r) => r.data);
const page = async <T,>(path: string, query: Record<string, string | number | undefined>): Promise<Paged<T>> => {
  const res = await api<T[]>(path, { query });
  return { items: res.data, meta: res.meta! };
};

/** Re-renders every `intervalMs` so countdowns tick. Returns the browser clock in ms. */
export function useTicker(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// ---------------------------------------------------------------- slots
export function useSlots(params: { page?: number; pageSize?: number; includePast?: 'true' | 'false'; active?: 'true' | 'false' }, enabled = true) {
  return useQuery({ queryKey: ['slots', params], enabled, queryFn: () => page<Slot>('/slots', params), placeholderData: keepPreviousData });
}
export const useCreateSlot = () => useAction((input: { startsAt: string; endsAt: string; capacity: number }) => post<Slot>('/slots', input));
export const useUpdateSlot = () =>
  useAction(({ id, ...body }: { id: string; capacity?: number; isActive?: boolean }) => api<Slot>(`/slots/${id}`, { method: 'PATCH', body }).then((r) => r.data));

// ---------------------------------------------------------------- bookings and gate
export function useBookings(params: { page?: number; pageSize?: number; status?: BookingStatus | '' }, refetchMs?: number) {
  return useQuery({
    queryKey: ['bookings', 'list', params],
    queryFn: () => page<Booking>('/bookings', params),
    placeholderData: keepPreviousData,
    ...(refetchMs ? { refetchInterval: refetchMs } : {}),
  });
}
export function useBooking(id: string | undefined) {
  return useQuery({ queryKey: ['bookings', 'detail', id], enabled: Boolean(id), queryFn: async () => (await api<Booking>(`/bookings/${id}`)).data });
}
export const useCreateBooking = () => useAction((input: { collectionJobId: string; slotId: string }) => post<Booking>('/bookings', input));
export const useRescheduleBooking = (id: string) => useAction((input: { slotId: string; reason: string }) => post<Booking>(`/bookings/${id}/reschedule`, input));
export const useCancelBooking = (id: string) => useAction((input: { reason: string }) => post<Booking>(`/bookings/${id}/cancel`, input));
export const useNoShow = (id: string) => useAction((input: { reason?: string }) => post<Booking>(`/bookings/${id}/no-show`, input));

const PATH: Record<GateAction, string> = {
  arrive: 'arrive', verify: 'verify', hold: 'hold', reject: 'reject', admit: 'admit', exit: 'exit', releaseHold: 'release-hold', override: 'override',
};
export const useGateAction = () =>
  useAction(({ bookingId, action, ...body }: { bookingId: string; action: GateAction; registrationNumber?: string; reason?: string }) =>
    post<Booking>(`/bookings/${bookingId}/${PATH[action]}`, body),
  );

// ---------------------------------------------------------------- shipments and weights
export function useShipments(params: { page?: number; pageSize?: number; status?: ShipmentStatus | ''; q?: string }) {
  return useQuery({ queryKey: ['shipments', 'list', params], queryFn: () => page<Shipment>('/shipments', params), placeholderData: keepPreviousData });
}
export function useShipment(id: string | undefined) {
  return useQuery({ queryKey: ['shipments', 'detail', id], enabled: Boolean(id), queryFn: async () => (await api<Shipment>(`/shipments/${id}`)).data });
}
export const useRecordWeight = (id: string) => useAction((input: { kind: 'GROSS' | 'TARE'; valueKg: string }) => post<Shipment>(`/shipments/${id}/weights`, input));
export const useCorrectWeight = (id: string) =>
  useAction((input: { kind: 'GROSS' | 'TARE'; valueKg: string; reason: string }) => post<Shipment>(`/shipments/${id}/weights/correct`, input));
export const useReceiveShipment = (id: string) => useAction(() => post<Shipment>(`/shipments/${id}/receive`));
export const useReleaseShipment = (id: string) => useAction(() => post<Shipment>(`/shipments/${id}/release`));

// ---------------------------------------------------------------- exceptions
export function useExceptions(params: { page?: number; pageSize?: number; status?: ExceptionStatus | '' }) {
  return useQuery({ queryKey: ['exceptions', 'list', params], queryFn: () => page<ExceptionCase>('/exceptions', params), placeholderData: keepPreviousData });
}
export function useException(id: string | undefined) {
  return useQuery({ queryKey: ['exceptions', 'detail', id], enabled: Boolean(id), queryFn: async () => (await api<ExceptionCase>(`/exceptions/${id}`)).data });
}
export const useAddExceptionNote = (id: string) => useAction((input: { note: string }) => post<ExceptionCase>(`/exceptions/${id}/notes`, input));
export const useResolveException = (id: string) => useAction((input: { resolution: string }) => post<ExceptionCase>(`/exceptions/${id}/resolve`, input));

// ---------------------------------------------------------------- stations and queue
export function useStations(enabled = true) {
  return useQuery({ queryKey: ['stations'], enabled, queryFn: async () => (await api<Station[]>('/stations')).data });
}
export const useCreateStation = () => useAction((input: { name: string }) => post<Station>('/stations', input));
export const useUpdateStation = () =>
  useAction(({ id, ...body }: { id: string; name?: string; isActive?: boolean }) => api<Station>(`/stations/${id}`, { method: 'PATCH', body }).then((r) => r.data));

export function useQueue(params: { page?: number; pageSize?: number; status?: QueueStatus | '' }, refetchMs = 30_000) {
  return useQuery({
    queryKey: ['queue', params],
    queryFn: () => page<QueueEntry>('/queue', params),
    placeholderData: keepPreviousData,
    refetchInterval: refetchMs,
  });
}
export const useStartProcessing = (id: string) => useAction((input: { stationId: string }) => post<QueueEntry>(`/queue/${id}/start`, input));
export const useCompleteProcessing = (id: string) => useAction((input: { notes?: string }) => post<QueueEntry>(`/queue/${id}/complete`, input));
