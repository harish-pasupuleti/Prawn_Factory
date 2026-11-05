import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert, Button, Card, Dialog, EmptyState, PageHeader, Pagination, Pill, SelectField, Spinner, TextField } from '../components/ui';
import { useCreateVehicle, useUpdateVehicle, useVehicles } from '../features/fieldwork/hooks';
import { ApiError } from '../lib/api';
import { applyServerFieldErrors, errorMessage } from '../lib/errors';
import { formatKg } from '../lib/format';
import type { Vehicle } from '../lib/types';

const capacity = z.string().trim().regex(/^\d{1,9}(\.\d{1,3})?$/, 'Capacity must be a number with at most 3 decimal places').refine((v) => /[1-9]/.test(v), 'Capacity must be greater than zero');
const vehicleSchema = z.object({
  registrationNumber: z.string().trim().min(4, 'Registration number is required').max(20).regex(/^[A-Za-z0-9\s-]+$/, 'Use letters, digits and hyphens only'),
  capacityKg: capacity,
  description: z.string().trim().max(200).optional(),
});
type VehicleValues = z.infer<typeof vehicleSchema>;

function CreateVehicleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateVehicle();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, reset, setError, formState: { errors } } = useForm<VehicleValues>({ resolver: zodResolver(vehicleSchema), defaultValues: { description: '' } });
  const close = () => { reset(); setFormError(null); onClose(); };
  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await create.mutateAsync({ registrationNumber: v.registrationNumber, capacityKg: v.capacityKg, ...(v.description ? { description: v.description } : {}) });
      close();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VEHICLE_EXISTS') setError('registrationNumber', { type: 'server', message: err.message });
      else if (!applyServerFieldErrors(err, setError, ['registrationNumber', 'capacityKg', 'description'])) setFormError(errorMessage(err));
    }
  });
  return (
    <Dialog open={open} title="Add a vehicle" onClose={close}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}
        <TextField label="Registration number" placeholder="AP31TX1234" error={errors.registrationNumber?.message} {...register('registrationNumber')} />
        <TextField label="Capacity (kg)" inputMode="decimal" error={errors.capacityKg?.message} {...register('capacityKg')} />
        <TextField label="Description (optional)" error={errors.description?.message} {...register('description')} />
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={close}>Back</Button>
          <Button type="submit" loading={create.isPending}>Add vehicle</Button>
        </div>
      </form>
    </Dialog>
  );
}

function EditVehicleDialog({ vehicle, onClose }: { vehicle: Vehicle | null; onClose: () => void }) {
  const update = useUpdateVehicle();
  const [cap, setCap] = useState('');
  const [active, setActive] = useState<'true' | 'false' | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!vehicle) return null;
  const close = () => { setCap(''); setActive(null); setError(null); onClose(); };
  const nextActive = active ?? (vehicle.isActive ? 'true' : 'false');
  const changed = (cap.trim() !== '' && cap.trim() !== vehicle.capacityKg) || nextActive !== (vehicle.isActive ? 'true' : 'false');
  const save = async () => {
    setError(null);
    try {
      await update.mutateAsync({
        id: vehicle.id,
        ...(cap.trim() ? { capacityKg: cap.trim() } : {}),
        ...(nextActive !== (vehicle.isActive ? 'true' : 'false') ? { isActive: nextActive === 'true' } : {}),
      });
      close();
    } catch (err) {
      setError(err instanceof ApiError && Array.isArray(err.details) && err.details[0] ? err.details[0].message : errorMessage(err));
    }
  };
  return (
    <Dialog open title={`Edit ${vehicle.registrationNumber}`} onClose={close}>
      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
      <div className="space-y-4">
        <TextField label="Capacity (kg)" inputMode="decimal" placeholder={vehicle.capacityKg} value={cap} onChange={(e) => setCap(e.target.value)} hint="Leave empty to keep the current capacity" />
        <SelectField label="Status" value={nextActive} onChange={(e) => setActive(e.target.value as 'true' | 'false')} hint={vehicle.busy ? 'This vehicle has an active job and cannot be deactivated yet.' : undefined}>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </SelectField>
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <Button variant="secondary" onClick={close}>Back</Button>
        <Button onClick={() => void save()} disabled={!changed} loading={update.isPending}>Save changes</Button>
      </div>
    </Dialog>
  );
}

export function VehiclesPage() {
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const result = useVehicles({ page, pageSize: 10 });
  return (
    <>
      <PageHeader title="Vehicles" description="Transport vehicles available for collection jobs." actions={<Button onClick={() => setCreating(true)}>Add vehicle</Button>} />
      {result.isLoading ? <Spinner label="Loading vehicles" /> : result.isError ? <Alert tone="error">{errorMessage(result.error)}</Alert> : result.data!.items.length === 0 ? (
        <EmptyState title="No vehicles yet">Add a vehicle so the purchase manager can assign transport.</EmptyState>
      ) : (
        <>
          <Card className="!p-0 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <caption className="sr-only">Vehicles</caption>
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                <tr>
                  <th scope="col" className="px-4 py-3">Registration</th>
                  <th scope="col" className="px-4 py-3">Description</th>
                  <th scope="col" className="px-4 py-3 text-right">Capacity</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.data!.items.map((v) => (
                  <tr key={v.id}>
                    <td className="px-4 py-3 font-medium">{v.registrationNumber}</td>
                    <td className="px-4 py-3">{v.description ?? '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">{formatKg(v.capacityKg)}</td>
                    <td className="px-4 py-3"><span className="inline-flex gap-1"><Pill tone={v.isActive ? 'green' : 'slate'}>{v.isActive ? 'Active' : 'Inactive'}</Pill>{v.busy && <Pill tone="blue">On a job</Pill>}</span></td>
                    <td className="px-4 py-3 text-right"><Button variant="secondary" onClick={() => setEditing(v)}>Edit</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Pagination page={result.data!.meta.page} totalPages={result.data!.meta.totalPages} total={result.data!.meta.total} onChange={setPage} />
        </>
      )}
      <CreateVehicleDialog open={creating} onClose={() => setCreating(false)} />
      <EditVehicleDialog key={editing?.id ?? 'none'} vehicle={editing} onClose={() => setEditing(null)} />
    </>
  );
}
