"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Check, TriangleAlert } from "lucide-react";

import { isQuietAction } from "@/lib/activity";
import type { ActivityEntry } from "@/lib/events";
import { subscribeToActivity } from "@/lib/events";
import { getSessionId } from "@/lib/session";
import type { ActivityEventDTO } from "@/lib/types";

const VISIBLE_LIMIT = 4;
const DISMISS_AFTER_MS = 5500;
const POLL_INTERVAL_MS = 2000;

// Local id counter for entries derived from the activity table (bus entries
// use the shared counter in lib/events).
let nextStripId = 1_000_000;

/**
 * The live activity strip. Every entry — human or agent — is a row in the
 * shared ActivityEvent table; this strip is that table's screen:
 *
 * - the window bus gives instant display the moment an action happens on
 *   this page (tool call, board edit), carrying the new row's dbId,
 * - a 2s poll reads the table back, so entries created anywhere else still
 *   surface, and the strip and the agent's get_activity_log tool always
 *   agree (one source of truth),
 * - dbId dedupe keeps an entry from toasting twice (bus + poll),
 * - quiet actions (view_gear, card moves) are recorded but never toast,
 * - error toasts are UI feedback only — they never touch the table.
 */
export function ActivityStrip() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const seenDbIds = useRef(new Set<string>());
  const cursor = useRef<string | null>(null);

  useEffect(() => {
    /** Puts an entry on screen and schedules its dismissal. */
    const display = (entry: ActivityEntry) => {
      setEntries((current) => [entry, ...current].slice(0, VISIBLE_LIMIT));
      timers.current.set(
        entry.id,
        setTimeout(() => {
          setEntries((current) => current.filter((e) => e.id !== entry.id));
          timers.current.delete(entry.id);
        }, DISMISS_AFTER_MS),
      );
    };

    // Bus path (instant, in-page actions): check-and-mark the dbId, then
    // display unless the action is quiet.
    const unsubscribe = subscribeToActivity((entry) => {
      if (entry.action !== undefined && isQuietAction(entry.action)) return;
      if (entry.dbId !== undefined) {
        if (seenDbIds.current.has(entry.dbId)) return;
        seenDbIds.current.add(entry.dbId);
      }
      display(entry);
    });

    let stopped = false;
    const poll = async () => {
      if (stopped || (typeof document !== "undefined" && document.visibilityState === "hidden")) return;
      try {
        const params = new URLSearchParams({ sessionId: getSessionId(), limit: "30" });
        if (cursor.current !== null) params.set("after", cursor.current);
        const response = await fetch(`/api/activity?${params.toString()}`, { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { events: ActivityEventDTO[] };
        if (body.events.length === 0) return;
        const firstLoad = cursor.current === null;
        // Oldest → newest so the cursor is right and ordering reads naturally.
        // Check-and-mark happens HERE (the single marking site for this path)
        // — display() never re-checks, so a just-marked row still shows.
        for (const event of [...body.events].reverse()) {
          if (seenDbIds.current.has(event.id)) continue;
          seenDbIds.current.add(event.id);
          // First load only establishes the cursor — no toast storm on open.
          if (firstLoad) continue;
          // Quiet actions are recorded for the agent but never toast.
          if (isQuietAction(event.action)) continue;
          display({
            id: nextStripId++,
            kind: event.actor,
            message: event.detail,
            tool: event.action.startsWith("tool:") ? event.action.slice("tool:".length) : event.action,
            dbId: event.id,
            action: event.action,
            at: Date.parse(event.at),
          });
        }
        cursor.current = body.events[0].at;
      } catch {
        // Network hiccup — the next poll recovers.
      }
    };

    void poll();
    const pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);

    return () => {
      stopped = true;
      clearInterval(pollTimer);
      unsubscribe();
      timers.current.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  if (entries.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Board activity"
      className="pointer-events-none fixed bottom-4 left-4 z-50 flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2"
    >
      {entries.map((entry) => (
        <div
          key={entry.id}
          className="pointer-events-auto flex items-start gap-2.5 rounded-md border border-line bg-paper-raised px-3 py-2 shadow-md animate-in slide-in-from-left-4 fade-in duration-300"
        >
          {entry.kind === "agent" && (
            <Bot aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-moss" strokeWidth={1.75} />
          )}
          {entry.kind === "human" && (
            <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" strokeWidth={2} />
          )}
          {entry.kind === "error" && (
            <TriangleAlert
              aria-hidden="true"
              className="mt-0.5 h-4 w-4 shrink-0 text-clay"
              strokeWidth={1.75}
            />
          )}
          {entry.kind === "agent" && entry.message.startsWith("Agent ") ? (
            <p className="text-sm leading-snug text-ink-soft">
              <span className="font-medium text-moss-deep">Agent </span>
              {entry.message.slice("Agent ".length)}
            </p>
          ) : (
            <p className="text-sm leading-snug text-ink-soft">{entry.message}</p>
          )}
        </div>
      ))}
    </div>
  );
}
