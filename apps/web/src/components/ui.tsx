import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { STATUS_LABELS, type ProcurementStatus } from '../lib/types';

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const variants: Record<Variant, string> = {
  primary: 'bg-teal-700 text-white hover:bg-teal-800 disabled:bg-teal-300',
  secondary: 'bg-white text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-red-700 text-white hover:bg-red-800 disabled:bg-red-300',
  ghost: 'text-slate-700 hover:bg-slate-100 disabled:text-slate-400',
};

export function Button({
  variant = 'primary',
  className,
  loading,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cx(
        'inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed',
        variants[variant],
        className,
      )}
    >
      {loading && <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx('rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-6', className)}>{children}</section>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

const controlClass =
  'block w-full rounded-md border bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-teal-700 disabled:bg-slate-100';

interface FieldShellProps {
  label: string;
  error?: string | undefined;
  hint?: string;
  id: string;
  children: ReactNode;
}

function FieldShell({ label, error, hint, id, children }: FieldShellProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-800">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

interface BaseFieldProps {
  label: string;
  error?: string | undefined;
  hint?: string;
}

export const TextField = forwardRef<HTMLInputElement, BaseFieldProps & InputHTMLAttributes<HTMLInputElement>>(function TextField(
  { label, error, hint, className, ...props },
  ref,
) {
  const autoId = useId();
  const id = props.id ?? autoId;
  return (
    <FieldShell label={label} error={error} hint={hint} id={id}>
      <input
        {...props}
        id={id}
        ref={ref}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cx(controlClass, error ? 'border-red-500' : 'border-slate-300', className)}
      />
    </FieldShell>
  );
});

export const SelectField = forwardRef<HTMLSelectElement, BaseFieldProps & SelectHTMLAttributes<HTMLSelectElement>>(function SelectField(
  { label, error, hint, className, children, ...props },
  ref,
) {
  const autoId = useId();
  const id = props.id ?? autoId;
  return (
    <FieldShell label={label} error={error} hint={hint} id={id}>
      <select
        {...props}
        id={id}
        ref={ref}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cx(controlClass, error ? 'border-red-500' : 'border-slate-300', className)}
      >
        {children}
      </select>
    </FieldShell>
  );
});

export const TextAreaField = forwardRef<HTMLTextAreaElement, BaseFieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextAreaField(
  { label, error, hint, className, ...props },
  ref,
) {
  const autoId = useId();
  const id = props.id ?? autoId;
  return (
    <FieldShell label={label} error={error} hint={hint} id={id}>
      <textarea
        {...props}
        id={id}
        ref={ref}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cx(controlClass, error ? 'border-red-500' : 'border-slate-300', className)}
      />
    </FieldShell>
  );
});

const alertStyles = {
  error: 'border-red-200 bg-red-50 text-red-800',
  success: 'border-green-200 bg-green-50 text-green-800',
  info: 'border-sky-200 bg-sky-50 text-sky-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
} as const;

export function Alert({ tone = 'info', children }: { tone?: keyof typeof alertStyles; children: ReactNode }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('rounded-md border px-4 py-3 text-sm', alertStyles[tone])}>
      {children}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 text-sm text-slate-600">
      <span aria-hidden className="size-5 animate-spin rounded-full border-2 border-teal-700 border-t-transparent" />
      <span>{label}…</span>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <p className="font-medium text-slate-800">{title}</p>
      {children && <div className="mt-2 text-sm text-slate-600">{children}</div>}
    </div>
  );
}

const statusStyles: Record<ProcurementStatus, string> = {
  SUBMITTED: 'bg-sky-100 text-sky-800',
  CLARIFICATION_REQUESTED: 'bg-amber-100 text-amber-900',
  APPROVED: 'bg-green-100 text-green-800',
  INSPECTION_ASSIGNED: 'bg-indigo-100 text-indigo-800',
  INSPECTION_PASSED: 'bg-green-100 text-green-800',
  INSPECTION_FAILED: 'bg-red-100 text-red-800',
  INSPECTION_REVIEW: 'bg-amber-100 text-amber-900',
  TRANSPORT_ASSIGNED: 'bg-indigo-100 text-indigo-800',
  IN_TRANSIT: 'bg-violet-100 text-violet-800',
  DELIVERED: 'bg-teal-100 text-teal-800',
  RECEIVED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-slate-200 text-slate-700',
};

const generalStyles = {
  green: 'bg-green-100 text-green-800',
  red: 'bg-red-100 text-red-800',
  amber: 'bg-amber-100 text-amber-900',
  blue: 'bg-sky-100 text-sky-800',
  violet: 'bg-violet-100 text-violet-800',
  slate: 'bg-slate-200 text-slate-700',
} as const;

/** Generic coloured label for non-procurement statuses (inspection, collection, flags). */
export function Pill({ tone = 'slate', children }: { tone?: keyof typeof generalStyles; children: ReactNode }) {
  return <span className={cx('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium', generalStyles[tone])}>{children}</span>;
}

export function StatusBadge({ status }: { status: ProcurementStatus }) {
  return <span className={cx('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium', statusStyles[status])}>{STATUS_LABELS[status]}</span>;
}

export function Pagination({ page, totalPages, total, onChange }: { page: number; totalPages: number; total: number; onChange: (page: number) => void }) {
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-3 text-sm">
      <p className="text-slate-600">
        Page {page} of {totalPages} · {total} {total === 1 ? 'record' : 'records'}
      </p>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Previous
        </Button>
        <Button variant="secondary" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
          Next
        </Button>
      </div>
    </nav>
  );
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Accessible modal: focus is trapped, Escape closes, focus returns to the trigger. */
export function Dialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="max-h-[90vh] w-full overflow-y-auto rounded-t-xl bg-white p-6 shadow-xl sm:max-w-lg sm:rounded-xl">
        <h2 id={titleId} className="mb-4 text-lg font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
