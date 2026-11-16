/** Pure packing rules (no database access) so they are easy to test. */
import { toGrams } from '../../lib/quantity';

export const BOX_FORMS = ['HEAD_ON', 'HEADLESS'] as const;
export type BoxFormName = (typeof BOX_FORMS)[number];
export const BOX_FORM_LABELS: Record<BoxFormName, string> = { HEAD_ON: 'Head-on', HEADLESS: 'Headless' };

/** Size grades: prawns per kilogram, as sold in the trade. */
export const SIZE_GRADES = ['10-20', '20-30', '30-40', '40-50', '50-60', '60-70', '70-80', '80-100'] as const;

/** A packed box may differ from the required box weight by this much. */
export const BOX_WEIGHT_TOLERANCE_PCT = 2;
export const MAX_BOXES_PER_ENTRY = 50;
export const MAX_REQUIREMENT_LINES = 40;

/** Boxes can be recorded while the shipment is being processed, and until the manager approves the packing. */
export const PACKING_QUEUE_STATUSES = ['IN_PROGRESS', 'COMPLETED'] as const;

export const requirementKey = (form: string, sizeGrade: string, boxWeightKg: string): string => `${form}|${sizeGrade}|${toGrams(boxWeightKg)}`;

/** Is the actual box weight within the tolerance of the required one? Exact integer arithmetic. */
export function weightWithinTolerance(requiredKg: string, actualKg: string, tolerancePct = BOX_WEIGHT_TOLERANCE_PCT): boolean {
  const required = toGrams(requiredKg);
  const actual = toGrams(actualKg);
  const diff = actual > required ? actual - required : required - actual;
  return diff * 100n <= required * BigInt(tolerancePct);
}

export interface RequirementProgress {
  requirementId: string;
  required: number;
  packed: number;
  remaining: number;
}

export function progressFor(requirements: { id: string; quantity: number }[], boxes: { requirementId: string; status: string }[]): RequirementProgress[] {
  return requirements.map((r) => {
    const packed = boxes.filter((b) => b.requirementId === r.id && b.status === 'PACKED').length;
    return { requirementId: r.id, required: r.quantity, packed, remaining: Math.max(0, r.quantity - packed) };
  });
}
