import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '../auth/AuthContext';
import { Alert, Button, Card, TextField } from '../components/ui';
import { publicApi } from '../lib/api';
import { applyServerFieldErrors, errorMessage } from '../lib/errors';

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <p className="mb-1 text-center text-sm font-semibold uppercase tracking-wide text-teal-800">Prawn Factory Management</p>
        <Card>
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="mb-5 mt-1 text-sm text-slate-600">{subtitle}</p>
          {children}
        </Card>
      </div>
    </div>
  );
}

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});
type LoginValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { from?: string; registered?: boolean } | null;
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  if (user) return <Navigate to="/" replace />;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login(values.email, values.password);
      navigate(state?.from ?? '/', { replace: true });
    } catch (err) {
      setFormError(errorMessage(err, 'Unable to sign in right now. Please try again.'));
    }
  });

  return (
    <AuthShell title="Sign in" subtitle="Use the account provided by your administrator, or register as a farmer.">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {state?.registered && <Alert tone="success">Registration complete. You can sign in now.</Alert>}
        {formError && <Alert tone="error">{formError}</Alert>}
        <TextField label="Email" type="email" autoComplete="username" error={errors.email?.message} {...register('email')} />
        <TextField label="Password" type="password" autoComplete="current-password" error={errors.password?.message} {...register('password')} />
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Sign in
        </Button>
        <p className="text-center text-sm text-slate-600">
          New farmer?{' '}
          <Link to="/register" className="font-medium text-teal-800 underline">
            Create an account
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}

const registerSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Full name is required').max(100),
    email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
    phone: z
      .string()
      .trim()
      .transform((v) => v.replace(/[\s-]/g, ''))
      .pipe(z.string().regex(/^(\+91)?[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number')),
    village: z.string().trim().min(2, 'Village is required').max(100),
    district: z.string().trim().min(2, 'District is required').max(100),
    state: z.string().trim().min(2, 'State is required').max(100),
    password: z.string().min(10, 'Password must be at least 10 characters').max(128, 'Password is too long'),
    confirmPassword: z.string().min(1, 'Confirm your password'),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });
type RegisterValues = z.input<typeof registerSchema>;

export function RegisterPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({ resolver: zodResolver(registerSchema) });

  if (user) return <Navigate to="/" replace />;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const { confirmPassword: _ignored, ...payload } = values;
    try {
      await publicApi('/auth/register', payload);
      navigate('/login', { replace: true, state: { registered: true } });
    } catch (err) {
      if (!applyServerFieldErrors(err, setError, ['fullName', 'email', 'phone', 'village', 'district', 'state', 'password'])) {
        setFormError(errorMessage(err, 'Registration failed. Please try again.'));
      }
    }
  });

  return (
    <AuthShell title="Farmer registration" subtitle="Create an account to submit procurement requests.">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert tone="error">{formError}</Alert>}
        <TextField label="Full name" autoComplete="name" error={errors.fullName?.message} {...register('fullName')} />
        <TextField label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
        <TextField label="Mobile number" inputMode="tel" autoComplete="tel" hint="10-digit Indian mobile number" error={errors.phone?.message} {...register('phone')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Village" error={errors.village?.message} {...register('village')} />
          <TextField label="District" error={errors.district?.message} {...register('district')} />
        </div>
        <TextField label="State" error={errors.state?.message} {...register('state')} />
        <TextField label="Password" type="password" autoComplete="new-password" hint="At least 10 characters" error={errors.password?.message} {...register('password')} />
        <TextField label="Confirm password" type="password" autoComplete="new-password" error={errors.confirmPassword?.message} {...register('confirmPassword')} />
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Create account
        </Button>
        <p className="text-center text-sm text-slate-600">
          Already registered?{' '}
          <Link to="/login" className="font-medium text-teal-800 underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
