import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useAction as useSharedAction } from '../../lib/mutations';
import type {
  Assignee, Collection, CollectionStatus, DecisionKind, IncidentType, Inspection, InspectionOutcome, InspectionStatus, Paged, Vehicle,
} from '../../lib/types';

const ALL_KEYS = ['requests', 'stats', 'inspections', 'collections', 'vehicles', 'assignees'] as const;

/** Every workflow action can change several screens; they refresh in the background (see useAction). */
const useAction = <TInput, TOutput = unknown>(fn: (input: TInput) => Promise<TOutput>, detailKey?: string) =>
  useSharedAction(fn, ALL_KEYS, detailKey);

const post = <T,>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body }).then((r) => r.data);

// ---------------------------------------------------------------- inspections
export interface InspectionListParams {
  page?: number;
  pageSize?: number;
  status?: InspectionStatus | '';
  outcome?: InspectionOutcome | '';
}

export function useInspections(params: InspectionListParams) {
  return useQuery({
    queryKey: ['inspections', 'list', params],
    queryFn: async (): Promise<Paged<Inspection>> => {
      const res = await api<Inspection[]>('/inspections', { query: { ...params } });
      return { items: res.data, meta: res.meta! };
    },
    placeholderData: keepPreviousData,
  });
}

export function useInspection(id: string | undefined) {
  return useQuery({
    queryKey: ['inspections', 'detail', id],
    enabled: Boolean(id),
    queryFn: async () => (await api<Inspection>(`/inspections/${id}`)).data,
  });
}

export interface InspectionFindings {
  outcome: InspectionOutcome;
  observedSpecies: string;
  observedSizeCount: string;
  inspectedQuantityKg: string;
  qualityNotes: string;
  discrepancyNotes?: string;
}

export const useAssignInspection = (requestId: string) =>
  useAction((input: { officerId: string }) => post<Inspection>(`/procurement/${requestId}/inspections`, input), 'inspections');

/** Assigns the field officer and the transport officer + vehicle in one request, so transport does not wait for the inspection. */
export const useAssignBoth = (requestId: string) =>
  useAction((input: { officerId: string; transport: { transportOfficerId: string; vehicleId: string; scheduledPickupAt?: string | undefined; expectedArrivalAt?: string | undefined } }) =>
    post<{ inspectionId: string; collectionId: string }>(`/procurement/${requestId}/assignments`, input),
  );
export const useStartInspection = (id: string) => useAction(() => post<Inspection>(`/inspections/${id}/start`), 'inspections');
export const useCompleteInspection = (id: string) => useAction((input: InspectionFindings) => post<Inspection>(`/inspections/${id}/complete`, input), 'inspections');
export const useDecideInspection = (id: string) =>
  useAction((input: { decision: DecisionKind; reason: string }) => post<Inspection>(`/inspections/${id}/decision`, input), 'inspections');
export const useCancelInspection = (id: string) => useAction((input: { reason: string }) => post<Inspection>(`/inspections/${id}/cancel`, input), 'inspections');

// ---------------------------------------------------------------- collections
export interface CollectionListParams {
  page?: number;
  pageSize?: number;
  status?: CollectionStatus | '';
}

export function useCollections(params: CollectionListParams) {
  return useQuery({
    queryKey: ['collections', 'list', params],
    queryFn: async (): Promise<Paged<Collection>> => {
      const res = await api<Collection[]>('/collections', { query: { ...params } });
      return { items: res.data, meta: res.meta! };
    },
    placeholderData: keepPreviousData,
  });
}

export function useCollection(id: string | undefined) {
  return useQuery({
    queryKey: ['collections', 'detail', id],
    enabled: Boolean(id),
    queryFn: async () => (await api<Collection>(`/collections/${id}`)).data,
  });
}

export const useAssignTransport = (requestId: string) =>
  useAction((input: { transportOfficerId: string; vehicleId: string; scheduledPickupAt?: string | undefined; expectedArrivalAt?: string | undefined }) =>
    post<Collection>(`/procurement/${requestId}/collections`, input),
  );
export const usePickup = (id: string) => useAction(() => post<Collection>(`/collections/${id}/pickup`), 'collections');
export const useLoad = (id: string) => useAction((input: { collectedQuantityKg: string; notes?: string }) => post<Collection>(`/collections/${id}/load`, input), 'collections');
export const useDispatch = (id: string) => useAction((input: { expectedArrivalAt?: string | undefined }) => post<Collection>(`/collections/${id}/dispatch`, input), 'collections');
export const useArrive = (id: string) => useAction(() => post<Collection>(`/collections/${id}/arrive`), 'collections');
export const useHandover = (id: string) => useAction((input: { notes?: string }) => post<Collection>(`/collections/${id}/handover`, input), 'collections');
export const useReportIncident = (id: string) =>
  useAction((input: { type: IncidentType; description: string; quantityAffectedKg?: string }) => post<Collection>(`/collections/${id}/incidents`, input), 'collections');
export const useCancelCollection = (id: string) => useAction((input: { reason: string }) => post<Collection>(`/collections/${id}/cancel`, input), 'collections');

// ---------------------------------------------------------------- directory + vehicles
export function useAssignees(role: 'FIELD_OFFICER' | 'TRANSPORT_OFFICER', enabled = true) {
  return useQuery({
    queryKey: ['assignees', role],
    enabled,
    queryFn: async () => (await api<Assignee[]>('/assignees', { query: { role } })).data,
  });
}

export function useVehicles(params: { page?: number; pageSize?: number; active?: 'true' | 'false' | '' }, enabled = true) {
  return useQuery({
    queryKey: ['vehicles', params],
    enabled,
    queryFn: async (): Promise<Paged<Vehicle>> => {
      const res = await api<Vehicle[]>('/vehicles', { query: { ...params } });
      return { items: res.data, meta: res.meta! };
    },
    placeholderData: keepPreviousData,
  });
}

export const useCreateVehicle = () =>
  useAction((input: { registrationNumber: string; capacityKg: string; description?: string }) =>
    api<Vehicle>('/vehicles', { method: 'POST', body: input }).then((r) => r.data),
  );
export const useUpdateVehicle = () =>
  useAction(({ id, ...body }: { id: string; capacityKg?: string; description?: string; isActive?: boolean }) =>
    api<Vehicle>(`/vehicles/${id}`, { method: 'PATCH', body }).then((r) => r.data),
  );
