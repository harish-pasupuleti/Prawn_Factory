import { toGrams } from '../../lib/quantity';

export const PAYMENT_METHODS = ['BANK_TRANSFER', 'UPI', 'CASH', 'CHEQUE'] as const;
export const PAYMENT_METHOD_LABELS: Record<(typeof PAYMENT_METHODS)[number], string> = {
  BANK_TRANSFER: 'Bank transfer',
  UPI: 'UPI',
  CASH: 'Cash',
  CHEQUE: 'Cheque',
};

/** "123.45" -> 12345 paise. The rate has at most 2 decimal places. */
function toPaise(rate: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(rate);
  if (!m) throw new Error('Invalid rate');
  return BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0'));
}

/** Amount = quantity (kg) x rate (INR per kg), in exact integer arithmetic, rounded half up to the paisa. */
export function computeAmountInr(quantityKg: string, ratePerKg: string): string {
  const grams = toGrams(quantityKg);
  const paise = (grams * toPaise(ratePerKg) + 500n) / 1000n;
  return `${paise / 100n}.${String(paise % 100n).padStart(2, '0')}`;
}

/** What the farmer is told. */
export type PaymentState = 'AWAITING_DECISION' | 'PAY_LATER' | 'PAID';
