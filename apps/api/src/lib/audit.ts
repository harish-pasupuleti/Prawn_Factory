import type { Prisma } from '@prisma/client';
import type { Tx } from './prisma';

const SENSITIVE_KEY = /password|token|secret|sealcode/i;

/** Recursively drops sensitive keys and converts values (Decimal, Date) to plain JSON. */
export function scrub(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  const walk = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(walk);
    // Dates and Prisma Decimals expose toJSON(); use it instead of enumerating their internals.
    if (input && typeof input === 'object' && typeof (input as { toJSON?: unknown }).toJSON === 'function') {
      return (input as { toJSON: () => unknown }).toJSON();
    }
    if (input && typeof input === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
        if (!SENSITIVE_KEY.test(key)) out[key] = walk(val);
      }
      return out;
    }
    return input;
  };
  return JSON.parse(JSON.stringify(walk(value))) as Prisma.InputJsonValue;
}

export interface AuditInput {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/** Always call inside the same transaction as the change being audited. */
export async function recordAudit(tx: Tx, event: AuditInput): Promise<void> {
  await tx.auditEvent.create({
    data: {
      actorId: event.actorId ?? null,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      before: scrub(event.before),
      after: scrub(event.after),
      ip: event.ip ?? null,
    },
  });
}
