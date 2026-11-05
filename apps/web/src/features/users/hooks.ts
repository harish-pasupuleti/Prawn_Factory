import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { Paged, Role, User, UserStatus } from '../../lib/types';

export interface UserListParams {
  page?: number;
  pageSize?: number;
  role?: Role | '';
  status?: UserStatus | '';
  q?: string;
}

export function useUsers(params: UserListParams) {
  return useQuery({
    queryKey: ['users', params],
    queryFn: async (): Promise<Paged<User>> => {
      const res = await api<User[]>('/users', { query: { ...params } });
      return { items: res.data, meta: res.meta! };
    },
    placeholderData: keepPreviousData,
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string; fullName: string; role: Role }) =>
      api<User>('/users', { method: 'POST', body: input }).then((r) => r.data),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; fullName?: string; role?: Role; status?: UserStatus }) =>
      api<User>(`/users/${id}`, { method: 'PATCH', body }).then((r) => r.data),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
}
