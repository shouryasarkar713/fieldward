/** Formats an integer amount of cents as a dollar string, e.g. 18900 -> "$189.00". */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
