import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAuth } from '../auth/AuthContext';
import { Alert, Button, Card, Dialog, EmptyState, PageHeader, Pagination, SelectField, Spinner, TextField } from '../components/ui';
import { useCreateUser, useUpdateUser, useUsers } from '../features/users/hooks';
import { applyServerFieldErrors, errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import { ROLES, ROLE_LABELS, STAFF_ROLES, type Role, type User, type UserStatus } from '../lib/types';

const createSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name is required').max(100),
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(10, 'Password must be at least 10 characters').max(128),
  role: z.enum(STAFF_ROLES as unknown as [Role, ...Role[]]),
});
type CreateValues = z.infer<typeof createSchema>;

function CreateUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateUser();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<CreateValues>({ resolver: zodResolver(createSchema), defaultValues: { role: 'PURCHASE_MANAGER' } });

  const close = () => {
    reset();
    setFormError(null);
    onClose();
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await create.mutateAsync(values);
      close();
    } catch (err) {
      if (!applyServerFieldErrors(err, setError, ['fullName', 'email', 'password', 'role'])) setFormError(errorMessage(err));
    }
  });

  return (
    <Dialog open={open} title="Create staff account" onClose={close}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}
        <TextField label="Full name" error={errors.fullName?.message} {...register('fullName')} />
        <TextField label="Email" type="email" error={errors.email?.message} {...register('email')} />
        <TextField label="Temporary password" type="password" autoComplete="new-password" hint="At least 10 characters. Share it securely." error={errors.password?.message} {...register('password')} />
        <SelectField label="Role" error={errors.role?.message} {...register('role')}>
          {STAFF_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </SelectField>
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={close}>
            Back
          </Button>
          <Button type="submit" loading={create.isPending}>
            Create account
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function EditUserDialog({ target, onClose }: { target: User | null; onClose: () => void }) {
  const update = useUpdateUser();
  const [role, setRole] = useState<Role | null>(null);
  const [status, setStatus] = useState<UserStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!target) return null;
  const nextRole = role ?? target.role;
  const nextStatus = status ?? target.status;
  const changed = nextRole !== target.role || nextStatus !== target.status;

  const close = () => {
    setRole(null);
    setStatus(null);
    setError(null);
    onClose();
  };

  const save = async () => {
    setError(null);
    try {
      await update.mutateAsync({
        id: target.id,
        ...(nextRole !== target.role ? { role: nextRole } : {}),
        ...(nextStatus !== target.status ? { status: nextStatus } : {}),
      });
      close();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog open title={`Edit ${target.fullName}`} onClose={close}>
      {error && (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      <div className="space-y-4">
        <SelectField label="Role" value={nextRole} disabled={target.role === 'FARMER'} hint={target.role === 'FARMER' ? 'Farmer accounts cannot change role.' : undefined} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.filter((r) => r !== 'FARMER' || target.role === 'FARMER').map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </SelectField>
        <SelectField label="Status" value={nextStatus} onChange={(e) => setStatus(e.target.value as UserStatus)}>
          <option value="ACTIVE">Active</option>
          <option value="DISABLED">Disabled</option>
        </SelectField>
        {changed && <Alert tone="warning">Changing the role or disabling the account signs the user out of every device immediately. This is recorded in the audit log.</Alert>}
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <Button variant="secondary" onClick={close}>
          Back
        </Button>
        <Button onClick={() => void save()} disabled={!changed} loading={update.isPending}>
          Save changes
        </Button>
      </div>
    </Dialog>
  );
}

export function UsersPage() {
  const { user: me } = useAuth();
  const [page, setPage] = useState(1);
  const [role, setRole] = useState<Role | ''>('');
  const [status, setStatus] = useState<UserStatus | ''>('');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const result = useUsers({ page, pageSize: 10, role, status, q });

  return (
    <>
      <PageHeader title="Users" description="Create staff accounts and manage roles and access. Farmers register themselves." actions={<Button onClick={() => setCreating(true)}>Create staff account</Button>} />
      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField label="Search name or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <SelectField label="Role" value={role} onChange={(e) => { setRole(e.target.value as Role | ''); setPage(1); }}>
            <option value="">All roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </SelectField>
          <SelectField label="Status" value={status} onChange={(e) => { setStatus(e.target.value as UserStatus | ''); setPage(1); }}>
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="DISABLED">Disabled</option>
          </SelectField>
        </div>
      </Card>

      {result.isLoading ? (
        <Spinner label="Loading users" />
      ) : result.isError ? (
        <Alert tone="error">{errorMessage(result.error, 'Could not load users.')}</Alert>
      ) : result.data!.items.length === 0 ? (
        <EmptyState title="No users match" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <caption className="sr-only">User accounts</caption>
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                <tr>
                  <th scope="col" className="px-4 py-3">Name</th>
                  <th scope="col" className="px-4 py-3">Email</th>
                  <th scope="col" className="px-4 py-3">Role</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Created</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.data!.items.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-3 font-medium">{u.fullName}</td>
                    <td className="px-4 py-3">{u.email}</td>
                    <td className="px-4 py-3">{ROLE_LABELS[u.role]}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${u.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-700'}`}>{u.status === 'ACTIVE' ? 'Active' : 'Disabled'}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{formatDateTime(u.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      {u.id === me?.id ? <span className="text-xs text-slate-500">You</span> : <Button variant="secondary" onClick={() => setEditing(u)}>Edit</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={result.data!.meta.page} totalPages={result.data!.meta.totalPages} total={result.data!.meta.total} onChange={setPage} />
        </>
      )}

      <CreateUserDialog open={creating} onClose={() => setCreating(false)} />
      <EditUserDialog key={editing?.id ?? 'none'} target={editing} onClose={() => setEditing(null)} />
    </>
  );
}
