"use client";

/**
 * A tiny window-event bus that glues the WebMCP tools (plain functions) to
 * the React UI without importing React into the tool layer.
 *
 * - `fieldward:activity` — a tool or the UI did something worth a toast in
 *   the activity strip (agent placements, human edits, errors).
 * - `fieldward:board-changed` — the board changed out-of-band (an agent tool
 *   call); the board store refreshes immediately instead of waiting for the
 *   next poll — this is what makes agent placements animate live.
 * - `fieldward:brief-changed` — same idea for the trip brief (agent proposal
 *   landed, human accepted, plan locked).
 */

export type ActivityKind = "agent" | "human" | "error";

export type ActivityEntry = {
  id: number;
  kind: ActivityKind;
  message: string;
  /** WebMCP tool name, when the entry came from a tool execution. */
  tool?: string;
  /** Row id in the ActivityEvent table, when this entry has been persisted. */
  dbId?: string;
  /** Machine action name ("view_gear", "tool:place_on_board") — used to filter quiet entries. */
  action?: string;
  at: number;
};

const ACTIVITY_EVENT = "fieldward:activity";
const BOARD_CHANGED_EVENT = "fieldward:board-changed";
const BRIEF_CHANGED_EVENT = "fieldward:brief-changed";

let nextActivityId = 1;

export function pushActivity(entry: {
  kind: ActivityKind;
  message: string;
  tool?: string;
  dbId?: string;
  action?: string;
}): void {
  if (typeof window === "undefined") return;
  const activity: ActivityEntry = { id: nextActivityId++, at: Date.now(), ...entry };
  window.dispatchEvent(new CustomEvent<ActivityEntry>(ACTIVITY_EVENT, { detail: activity }));
}

export function notifyBoardChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(BOARD_CHANGED_EVENT));
}

export function notifyBriefChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(BRIEF_CHANGED_EVENT));
}

export function subscribeToActivity(listener: (entry: ActivityEntry) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<ActivityEntry>).detail);
  window.addEventListener(ACTIVITY_EVENT, handler);
  return () => window.removeEventListener(ACTIVITY_EVENT, handler);
}

export function subscribeToBoardChanges(listener: () => void): () => void {
  window.addEventListener(BOARD_CHANGED_EVENT, listener);
  return () => window.removeEventListener(BOARD_CHANGED_EVENT, listener);
}

export function subscribeToBriefChanges(listener: () => void): () => void {
  window.addEventListener(BRIEF_CHANGED_EVENT, listener);
  return () => window.removeEventListener(BRIEF_CHANGED_EVENT, listener);
}
