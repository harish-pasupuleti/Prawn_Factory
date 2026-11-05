import { useMutation, useQueryClient } from '@tanstack/react-query';

/**
 * Shared wrapper for every "do something" button. The mutation settles as soon as the server confirms,
 * so the button is released immediately; related screens refresh in the background.
 * - The server returns the updated record, so when `detailKey` is given it is written straight into
 *   that record's detail cache instead of being fetched again.
 * - Invalidating a query that is not on screen only marks it stale (no network call).
 */
export function useAction<TInput, TOutput = unknown>(
  fn: (input: TInput) => Promise<TOutput>,
  keys: readonly string[],
  detailKey?: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      const id = (data as { id?: unknown } | null | undefined)?.id;
      if (detailKey && typeof id === 'string') queryClient.setQueryData([detailKey, 'detail', id], data);
      for (const key of keys) {
        void queryClient.invalidateQueries({ queryKey: key === detailKey ? [key, 'list'] : [key] });
      }
    },
  });
}
