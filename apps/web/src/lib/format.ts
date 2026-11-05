const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
const kg = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 3 });

/** Display only. Values arrive from the API as exact decimal strings. */
export function formatInr(value: string | number): string {
  return inr.format(Number(value));
}

export function formatKg(value: string | number): string {
  return `${kg.format(Number(value))} kg`;
}

export function formatDate(isoDate: string): string {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
}

/** Formats an amended or original field value for display. */
export function formatFieldValue(field: string, value: string): string {
  if (value === '') return '—';
  switch (field) {
    case 'declaredQuantityKg':
      return formatKg(value);
    case 'expectedPriceInrPerKg':
      return formatInr(value);
    case 'availabilityDate':
      return formatDate(value);
    default:
      return value;
  }
}
