import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from './api';

export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof ApiError) return err.status >= 500 ? `${fallback}${err.requestId ? ` (ref ${err.requestId.slice(0, 8)})` : ''}` : err.message;
  return fallback;
}

/** Copies server-side validation details onto the matching form fields. Returns true if any field was marked. */
export function applyServerFieldErrors<T extends FieldValues>(err: unknown, setError: UseFormSetError<T>, fields: readonly string[]): boolean {
  if (!(err instanceof ApiError) || err.code !== 'VALIDATION_ERROR' || !err.details) return false;
  let marked = false;
  for (const detail of err.details) {
    const root = detail.path.split('.')[0] ?? '';
    if (fields.includes(root)) {
      setError(root as Path<T>, { type: 'server', message: detail.message });
      marked = true;
    }
  }
  return marked;
}
