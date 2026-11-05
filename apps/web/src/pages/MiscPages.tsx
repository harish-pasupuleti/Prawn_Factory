import { Link } from 'react-router-dom';
import { Card } from '../components/ui';

export function ForbiddenPage() {
  return (
    <Card className="mx-auto max-w-lg text-center">
      <h1 className="text-xl font-semibold">Not available for your role</h1>
      <p className="mt-2 text-sm text-slate-600">You do not have permission to open this page.</p>
      <Link to="/" className="mt-4 inline-block font-medium text-teal-800 underline">
        Back to dashboard
      </Link>
    </Card>
  );
}

export function NotFoundPage() {
  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <Card className="max-w-lg text-center">
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-slate-600">The page you are looking for does not exist.</p>
        <Link to="/" className="mt-4 inline-block font-medium text-teal-800 underline">
          Go to dashboard
        </Link>
      </Card>
    </div>
  );
}
