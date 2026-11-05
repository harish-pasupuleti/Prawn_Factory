import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Alert, Button, Card, PageHeader, TextAreaField, TextField } from '../components/ui';
import { useSubmitRequest } from '../features/procurement/hooks';
import { applyServerFieldErrors, errorMessage } from '../lib/errors';

const positive = (label: string, decimals: number) =>
  z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{1,9}(\\.\\d{1,${decimals}})?$`), `${label} must be a number with at most ${decimals} decimal places`)
    .refine((v) => /[1-9]/.test(v), `${label} must be greater than zero`);

const todayLocal = () => new Date().toLocaleDateString('en-CA');

export const newRequestSchema = z.object({
  species: z.string().trim().min(2, 'Species is required').max(80),
  declaredSizeCount: z.string().trim().min(1, 'Size or count is required').max(60),
  declaredQuantityKg: positive('Quantity', 3),
  expectedPriceInrPerKg: positive('Price', 2),
  availabilityDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date')
    .refine((v) => v >= todayLocal(), 'Availability date cannot be in the past'),
  notes: z.string().trim().max(1000, 'Notes are too long').optional(),
});
type Values = z.infer<typeof newRequestSchema>;
const FIELDS = ['species', 'declaredSizeCount', 'declaredQuantityKg', 'expectedPriceInrPerKg', 'availabilityDate', 'notes'];

export function NewRequestPage() {
  const navigate = useNavigate();
  const submit = useSubmitRequest();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(newRequestSchema), defaultValues: { species: '', declaredSizeCount: '', notes: '' } });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const created = await submit.mutateAsync(values);
      navigate(`/requests/${created.id}`, { replace: true });
    } catch (err) {
      if (!applyServerFieldErrors(err, setError, FIELDS)) setFormError(errorMessage(err, 'Could not submit the request.'));
    }
  });

  return (
    <>
      <PageHeader title="New procurement request" description="Declare what you can supply. The purchase team reviews and verifies it before any collection." />
      <Card className="max-w-2xl">
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {formError && <Alert tone="error">{formError}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Species" placeholder="e.g. Vannamei" error={errors.species?.message} {...register('species')} />
            <TextField label="Declared size / count" placeholder="e.g. 30-40 count per kg" error={errors.declaredSizeCount?.message} {...register('declaredSizeCount')} />
            <TextField label="Estimated quantity (kg)" inputMode="decimal" hint="Up to 3 decimal places" error={errors.declaredQuantityKg?.message} {...register('declaredQuantityKg')} />
            <TextField label="Expected price (₹ per kg)" inputMode="decimal" hint="Up to 2 decimal places" error={errors.expectedPriceInrPerKg?.message} {...register('expectedPriceInrPerKg')} />
          </div>
          <TextField label="Availability date" type="date" min={todayLocal()} error={errors.availabilityDate?.message} {...register('availabilityDate')} />
          <TextAreaField label="Notes (optional)" rows={3} error={errors.notes?.message} {...register('notes')} />
          <p className="text-xs text-slate-500">Your declaration is preserved exactly as submitted. Later corrections are recorded as amendments with a reason.</p>
          <div className="flex gap-3">
            <Button type="submit" loading={submit.isPending}>
              Submit request
            </Button>
            <Link to="/requests" className="inline-flex min-h-10 items-center rounded-md px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
              Cancel
            </Link>
          </div>
        </form>
      </Card>
    </>
  );
}
