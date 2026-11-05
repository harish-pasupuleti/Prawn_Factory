import { useState } from 'react';
import { errorMessage } from '../lib/errors';
import { Alert, Button, Dialog, TextAreaField } from './ui';

/** Dialog that collects a reason (mandatory unless `required` is false) before a consequential action. */
export function ReasonDialog({
  open,
  title,
  description,
  label,
  confirmLabel,
  tone = 'primary',
  required = true,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  label: string;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  required?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<unknown>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tooShort = required && reason.trim().length < 3;

  const close = () => {
    setReason('');
    setError(null);
    onClose();
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      close();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} title={title} onClose={close}>
      <p className="mb-4 text-sm text-slate-600">{description}</p>
      {error && (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      <TextAreaField label={label} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} hint={required ? 'At least 3 characters' : undefined} />
      <div className="mt-5 flex justify-end gap-3">
        <Button variant="secondary" onClick={close} disabled={busy}>
          Back
        </Button>
        <Button variant={tone} onClick={() => void confirm()} disabled={tooShort} loading={busy}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
