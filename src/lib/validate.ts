/**
 * Small manual validation helpers — deliberately dependency-free.
 * Each returns either `{ ok: true, value }` or `{ ok: false, error }`.
 */
import { isValidDateOnly } from "@/lib/dates";

export type ParseResult<T> = { ok: true; value: T } | { ok: false, error: string };

export async function readJsonBody(request: Request): Promise<ParseResult<Record<string, unknown>>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, error: "Request body must be valid JSON." };
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }
  return { ok: true, value: body as Record<string, unknown> };
}

export function requireString(
  body: Record<string, unknown>,
  field: string,
  { max = 500 }: { max?: number } = {},
): ParseResult<string> {
  const value = body[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, error: `Field "${field}" is required and must be a non-empty string.` };
  }
  if (value.length > max) {
    return { ok: false, error: `Field "${field}" must be at most ${max} characters.` };
  }
  return { ok: true, value: value.trim() };
}

/**
 * Presence semantics for full-object editors: the field was SENT, possibly
 * empty. Unlike optionalString (which maps "" to undefined = "not sent"),
 * this keeps "" as "" — so the brief editor can deliberately clear a value.
 * Undefined/null still means "not sent".
 */
export function sentString(
  body: Record<string, unknown>,
  field: string,
  { max = 500 }: { max?: number } = {},
): ParseResult<string | undefined> {
  const value = body[field];
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value !== "string") {
    return { ok: false, error: `Field "${field}" must be a string.` };
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    return { ok: false, error: `Field "${field}" must be at most ${max} characters.` };
  }
  return { ok: true, value: trimmed };
}

/**
 * Optional date-only field ("YYYY-MM-DD", must be a real calendar date).
 * Null/empty/absent → undefined (treated as "clear" by the brief editor,
 * which always sends the whole object).
 */
export function optionalDateOnly(
  body: Record<string, unknown>,
  field: string,
): ParseResult<string | undefined> {
  const value = body[field];
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: undefined };
  }
  if (typeof value !== "string" || !isValidDateOnly(value)) {
    return { ok: false, error: `Field "${field}" must be a real calendar date, YYYY-MM-DD.` };
  }
  return { ok: true, value };
}

export function optionalString(
  body: Record<string, unknown>,
  field: string,
  { max = 280 }: { max?: number } = {},
): ParseResult<string | undefined> {
  const value = body[field];
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== "string") {
    return { ok: false, error: `Field "${field}" must be a string.` };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: undefined };
  }
  if (trimmed.length > max) {
    return { ok: false, error: `Field "${field}" must be at most ${max} characters.` };
  }
  return { ok: true, value: trimmed };
}

export function optionalInt(
  body: Record<string, unknown>,
  field: string,
  { min, max }: { min?: number; max?: number } = {},
): ParseResult<number | undefined> {
  const value = body[field];
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return { ok: false, error: `Field "${field}" must be an integer.` };
  }
  if (min !== undefined && value < min) {
    return { ok: false, error: `Field "${field}" must be at least ${min}.` };
  }
  if (max !== undefined && value > max) {
    return { ok: false, error: `Field "${field}" must be at most ${max}.` };
  }
  return { ok: true, value };
}

export function optionalNumber(
  body: Record<string, unknown>,
  field: string,
  { min, max }: { min?: number; max?: number } = {},
): ParseResult<number | undefined> {
  const value = body[field];
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, error: `Field "${field}" must be a number.` };
  }
  if (min !== undefined && value < min) {
    return { ok: false, error: `Field "${field}" must be at least ${min}.` };
  }
  if (max !== undefined && value > max) {
    return { ok: false, error: `Field "${field}" must be at most ${max}.` };
  }
  return { ok: true, value };
}

export function requireStringArray(
  body: Record<string, unknown>,
  field: string,
  { minItems = 1, maxItems = 20 }: { minItems?: number; maxItems?: number } = {},
): ParseResult<string[]> {
  const value = body[field];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim().length > 0)) {
    return { ok: false, error: `Field "${field}" must be an array of non-empty strings.` };
  }
  if (value.length < minItems) {
    return { ok: false, error: `Field "${field}" must contain at least ${minItems} item(s).` };
  }
  if (value.length > maxItems) {
    return { ok: false, error: `Field "${field}" must contain at most ${maxItems} item(s).` };
  }
  return { ok: true, value: value.map((item) => (item as string).trim()) };
}

export function optionalStringArray(
  body: Record<string, unknown>,
  field: string,
  { maxItems = 20 }: { maxItems?: number } = {},
): ParseResult<string[] | undefined> {
  const value = body[field];
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }
  if (!Array.isArray(value) || !value.every((tag) => typeof tag === "string" && tag.trim().length > 0)) {
    return { ok: false, error: `Field "${field}" must be an array of non-empty strings.` };
  }
  if (value.length > maxItems) {
    return { ok: false, error: `Field "${field}" must contain at most ${maxItems} items.` };
  }
  return { ok: true, value: value.map((tag) => (tag as string).trim()) };
}

export function errorResponse(status: number, error: string): Response {
  return Response.json({ error }, { status });
}
