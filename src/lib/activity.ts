"use client";

import { pushActivity } from "@/lib/events";
import { getSessionId } from "@/lib/session";
import type { ActivityEventDTO } from "@/lib/types";

/**
 * The single write path into the shared activity log. Both parties use it:
 *
 * - the WebMCP tool layer logs every successful agent tool call
 *   (action "tool:<name>"),
 * - the board UI logs human actions (viewed gear, board placements/moves,
 *   trip brief edits and proposal resolutions).
 *
 * Writing also fires the instant on-screen toast (unless `quiet`), carrying
 * the new row's id so the toast strip can deduplicate it against its poll.
 * The strip reads the same table back via GET /api/activity — one source of
 * truth, two directions.
 */

/** Quiet actions are recorded for the agent to read but never toast. */
export function isQuietAction(action: string): boolean {
  return action.startsWith("view_");
}

export async function logActivity(entry: {
  actor: "human" | "agent";
  action: string;
  detail: string;
  /** Suppress the toast — the event is still recorded. */
  quiet?: boolean;
  /** WebMCP tool name, when this came from a tool execution. */
  tool?: string;
}): Promise<ActivityEventDTO | null> {
  if (typeof window === "undefined") return null;
  try {
    const response = await fetch("/api/activity/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: getSessionId(),
        actor: entry.actor,
        action: entry.action,
        detail: entry.detail,
      }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { event: ActivityEventDTO };
    if (!entry.quiet) {
      pushActivity({
        kind: entry.actor,
        message: entry.detail,
        tool: entry.tool ?? entry.action,
        dbId: body.event.id,
        action: entry.action,
      });
    }
    return body.event;
  } catch {
    // Logging must never break the action it describes.
    return null;
  }
}
