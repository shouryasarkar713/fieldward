/**
 * Date-only ("YYYY-MM-DD") helpers. Trip days are calendar days, not
 * instants — so they're parsed to noon UTC and formatted back with
 * toISOString().slice(0, 10), which keeps any timezone math from flipping
 * the calendar day in either direction.
 */

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date like "2026-02-17" (rejects "2026-02-30"). */
export function isValidDateOnly(value: string): boolean {
  if (!DATE_ONLY_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Parse "YYYY-MM-DD" to a noon-UTC Date, or null when invalid. */
export function parseDateOnly(value: string): Date | null {
  if (!isValidDateOnly(value)) return null;
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  return new Date(Date.UTC(year, month - 1, day, 12));
}

/** Format a Date back to "YYYY-MM-DD" (noon-UTC storage makes this safe). */
export function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Whole days from a to b (positive when b is later). Noon-UTC on both sides. */
export function daysBetween(a: string, b: string): number {
  const from = parseDateOnly(a);
  const to = parseDateOnly(b);
  if (from === null || to === null) return 0;
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/** "YYYY-MM-DD" plus n days, as "YYYY-MM-DD". */
export function addDays(value: string, days: number): string {
  const from = parseDateOnly(value);
  if (from === null) return value;
  return toDateOnly(new Date(from.getTime() + days * 86_400_000));
}

/** "2026-09-02" → "Sep 2", for human-facing copy. */
export function shortDateLabel(value: string): string {
  const date = parseDateOnly(value);
  if (date === null) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "2026-09-02" → "September 2026", for seasonal-average copy. */
export function monthYearLabel(value: string): string {
  const date = parseDateOnly(value);
  if (date === null) return value;
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
