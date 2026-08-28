import { db } from "@/lib/db";
import type { DayBlockProposal, DayOrderProposal, TripBriefProposal } from "@/lib/types";

/**
 * The generalized pending-proposal mechanism.
 *
 * One row per (session, kind): an agent suggests something consequential, the
 * suggestion sits here untouched, and the human resolves it (accept/dismiss)
 * through the matching route. It started life as a bespoke
 * TripBrief.proposalJson column for brief updates; day-order suggestions and
 * day-block proposals are subsequent domains, and the mechanism was extracted so
 * all share one shape, one banner pattern, and one set of semantics:
 *
 *   - propose REPLACES any pending proposal of the same kind (one suggestion
 *     on the table at a time per domain);
 *   - nothing is applied until the human accepts;
 *   - dismiss discards with no change;
 *   - resolving (either way) deletes the row — the activity log, not this
 *     table, is the durable record of verdicts.
 */

export const PROPOSAL_KINDS = ["brief", "day-order", "day-block"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export function isProposalKind(value: unknown): value is ProposalKind {
  return typeof value === "string" && (PROPOSAL_KINDS as readonly string[]).includes(value);
}

/* ── Brief payloads: {tripDescription?, budget} ──────────────────────────── */

export function parseBriefProposal(raw: string | null): TripBriefProposal | null {
  if (raw === null || raw.trim().length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    const proposal: TripBriefProposal = { budget: null };
    if (typeof record.tripDescription === "string") {
      proposal.tripDescription = record.tripDescription;
    }
    if (typeof record.budget === "number" && Number.isInteger(record.budget) && record.budget >= 0) {
      proposal.budget = record.budget;
    } else if (record.budget === null) {
      proposal.budget = null;
    }
    return proposal;
  } catch {
    return null;
  }
}

export function serializeBriefProposal(proposal: TripBriefProposal): string {
  return JSON.stringify({
    ...(proposal.tripDescription !== undefined ? { tripDescription: proposal.tripDescription } : {}),
    budget: proposal.budget,
  });
}

/* ── Day-order payloads: {orderedBoardItemIds, note} ─────────────────────── */

export function parseDayOrderProposal(raw: string | null): DayOrderProposal | null {
  if (raw === null || raw.trim().length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    if (
      !Array.isArray(record.orderedBoardItemIds) ||
      record.orderedBoardItemIds.length === 0 ||
      !record.orderedBoardItemIds.every((id) => typeof id === "string" && id.trim().length > 0)
    ) {
      return null;
    }
    return {
      orderedBoardItemIds: record.orderedBoardItemIds,
      note: typeof record.note === "string" && record.note.trim().length > 0 ? record.note : null,
    };
  } catch {
    return null;
  }
}

export function serializeDayOrderProposal(proposal: DayOrderProposal): string {
  return JSON.stringify({
    orderedBoardItemIds: proposal.orderedBoardItemIds,
    ...(proposal.note !== null ? { note: proposal.note } : {}),
  });
}

/* ── Day-block payloads: {label, text?, note?} ───────────────────────────── */

export function parseDayBlockProposal(raw: string | null): DayBlockProposal | null {
  if (raw === null || raw.trim().length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.label !== "string" || record.label.trim().length === 0) {
      return null;
    }
    return {
      label: record.label.trim(),
      text: typeof record.text === "string" && record.text.trim().length > 0 ? record.text.trim() : null,
      note: typeof record.note === "string" && record.note.trim().length > 0 ? record.note.trim() : null,
    };
  } catch {
    return null;
  }
}

export function serializeDayBlockProposal(proposal: DayBlockProposal): string {
  return JSON.stringify({
    label: proposal.label,
    ...(proposal.text !== null ? { text: proposal.text } : {}),
    ...(proposal.note !== null ? { note: proposal.note } : {}),
  });
}

/* ── Storage ─────────────────────────────────────────────────────────────── */

/** The raw payload string of the pending proposal for a kind, or null. */
export async function getProposalPayload(sessionId: string, kind: ProposalKind): Promise<string | null> {
  const row = await db.proposal.findUnique({
    where: { sessionId_kind: { sessionId, kind } },
    select: { payloadJson: true },
  });
  return row?.payloadJson ?? null;
}

/** Store (replacing any previous) a pending proposal for a kind. */
export async function putProposal(sessionId: string, kind: ProposalKind, payloadJson: string): Promise<void> {
  await db.proposal.upsert({
    where: { sessionId_kind: { sessionId, kind } },
    create: { sessionId, kind, payloadJson },
    update: { payloadJson },
  });
}

/** Delete the pending proposal for a kind, if any. */
export async function clearProposal(sessionId: string, kind: ProposalKind): Promise<void> {
  await db.proposal.deleteMany({ where: { sessionId, kind } });
}
