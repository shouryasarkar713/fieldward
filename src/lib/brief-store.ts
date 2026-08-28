"use client";

import { create } from "zustand";

import { logActivity } from "@/lib/activity";
import { subscribeToBriefChanges } from "@/lib/events";
import { getSessionId } from "@/lib/session";
import type { TripBriefDTO } from "@/lib/types";

/**
 * Client-side trip-brief state — the shared "what trip are we planning"
 * document. Same shape as the board store: server is the source of truth
 * (keyed by sessionId), the store polls it, and WebMCP tools poke it via
 * `fieldward:brief-changed` so an agent's pending proposal appears
 * immediately, with its Accept / Dismiss affordance.
 *
 * The agent NEVER writes tripDescription/budget directly — propose_trip_brief_update
 * stores a pending suggestion the human must resolve. That's the trust
 * boundary applied to framing, not just to the final lock.
 */

const POLL_INTERVAL_MS = 2000;

type BriefState = {
  sessionId: string | null;
  brief: TripBriefDTO | null;
  loaded: boolean;
  /** True once init() has run — guards against duplicate polling loops. */
  initialized: boolean;

  init: () => void;
  refresh: () => Promise<void>;
  /** Human direct edit from the brief panel. Budget in CENTS; place/dates optional. */
  save: (input: {
    tripDescription: string;
    budgetCents: number | null;
    location: string | null;
    startDate: string | null;
    endDate: string | null;
  }) => Promise<boolean>;
  /** Human answer to a pending agent proposal. */
  resolve: (decision: "accept" | "dismiss") => Promise<boolean>;
  /** Human-only: lock the plan (irreversible for this session's plan). */
  lock: () => Promise<boolean>;
  /** Human-only: wipe board + brief and start a fresh plan. */
  reset: () => Promise<boolean>;
};

let pollTimer: ReturnType<typeof setInterval> | null = null;

async function postBrief(
  path: string,
  payload: Record<string, unknown>,
): Promise<TripBriefDTO | null | undefined> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) return undefined;
  const body = (await response.json()) as { brief: TripBriefDTO | null };
  return body.brief;
}

export const useBriefStore = create<BriefState>((set, get) => ({
  sessionId: null,
  brief: null,
  loaded: false,
  initialized: false,

  init: () => {
    if (get().initialized) return;
    set({ initialized: true, sessionId: getSessionId() });

    void get().refresh();

    if (pollTimer === null) {
      pollTimer = setInterval(() => {
        if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
        void get().refresh();
      }, POLL_INTERVAL_MS);
    }

    subscribeToBriefChanges(() => void get().refresh());

    if (typeof window !== "undefined") {
      window.addEventListener("focus", () => void get().refresh());
    }
  },

  refresh: async () => {
    const sessionId = get().sessionId ?? getSessionId();
    if (sessionId.length === 0) return;
    try {
      const response = await fetch(`/api/brief?sessionId=${encodeURIComponent(sessionId)}`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const body = (await response.json()) as { brief: TripBriefDTO | null };
      const current = get();
      // Skip no-op writes so polling doesn't re-render the editor.
      const same =
        (current.brief === null && body.brief === null) ||
        (current.brief !== null &&
          body.brief !== null &&
          current.brief.tripDescription === body.brief.tripDescription &&
          current.brief.budget === body.brief.budget &&
          current.brief.location === body.brief.location &&
          current.brief.startDate === body.brief.startDate &&
          current.brief.endDate === body.brief.endDate &&
          current.brief.updatedBy === body.brief.updatedBy &&
          current.brief.lockedAt === body.brief.lockedAt &&
          JSON.stringify(current.brief.pendingProposal) === JSON.stringify(body.brief.pendingProposal));
      if (!same) {
        set({ sessionId, brief: body.brief, loaded: true });
      } else if (current.sessionId !== sessionId || !current.loaded) {
        set({ sessionId, loaded: true });
      }
    } catch {
      // Network hiccup — the next poll will recover.
    }
  },

  save: async (input) => {
    const sessionId = get().sessionId ?? getSessionId();
    try {
      const brief = await postBrief("/api/brief/update", {
        sessionId,
        tripDescription: input.tripDescription,
        budget: input.budgetCents,
        location: input.location ?? "",
        startDate: input.startDate,
        endDate: input.endDate,
        updatedBy: "human",
      });
      if (brief === undefined) return false;
      set({ brief });
      return true;
    } catch {
      return false;
    }
  },

  resolve: async (decision) => {
    const sessionId = get().sessionId ?? getSessionId();
    try {
      const brief = await postBrief("/api/brief/resolve", { sessionId, decision });
      if (brief === undefined) return false;
      set({ brief });
      void logActivity({
        actor: "human",
        action: "resolve_brief_proposal",
        detail:
          decision === "accept"
            ? "You accepted the agent's trip-brief suggestion."
            : "You dismissed the agent's trip-brief suggestion.",
        quiet: true,
      });
      return true;
    } catch {
      return false;
    }
  },

  lock: async () => {
    const sessionId = get().sessionId ?? getSessionId();
    try {
      const brief = await postBrief("/api/brief/lock", { sessionId });
      if (brief === undefined) return false;
      set({ brief });
      await logActivity({
        actor: "human",
        action: "lock_plan",
        detail: "You locked the plan. That step stays human.",
      });
      return true;
    } catch {
      return false;
    }
  },

  reset: async () => {
    const sessionId = get().sessionId ?? getSessionId();
    try {
      const response = await fetch("/api/brief/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (!response.ok) return false;
      const body = (await response.json()) as { brief: TripBriefDTO | null };
      set({ brief: body.brief });
      await logActivity({
        actor: "human",
        action: "reset_plan",
        detail: "You started a fresh plan.",
      });
      return true;
    } catch {
      return false;
    }
  },
}));
