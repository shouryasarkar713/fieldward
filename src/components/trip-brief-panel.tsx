"use client";

import { useState } from "react";
import { Lock } from "lucide-react";

import { ProposalBanner } from "@/components/proposal-banner";
import { WeatherChip } from "@/components/weather-chip";
import { logActivity } from "@/lib/activity";
import { useBriefStore } from "@/lib/brief-store";
import type { TripBriefDTO, TripBriefProposal } from "@/lib/types";

/**
 * The trip brief — the shared framing document for everything on the board:
 * what the trip is, where and when it runs, and what it should cost. Both
 * sides read it (the agent's get_trip_brief tool grounds every search and
 * pick in it), the weather outlook hangs off its place and dates, and the
 * readiness check compares the board against all of it.
 *
 * The agent NEVER writes here directly. propose_trip_brief_update lands as a
 * pending suggestion (below), and nothing changes until the human accepts
 * or dismisses it — the trust boundary applied to framing, not just locking.
 *
 * It's a real semantic <form> (labelled inputs, submit) — deliberately
 * structured so a declarative form layer could annotate it without JS
 * changes; see DECISIONS.md on the WebMCP Declarative API call. Place and
 * dates stay lightweight on purpose: one text input, two native date
 * inputs, no form wizard.
 */

/** Parses "$400", "400", "1,200.50" → cents. Returns null for blank/invalid. */
function parseBudgetDollars(raw: string): { cents: number | null; invalid: boolean } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { cents: null, invalid: false };
  const cleaned = trimmed.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return { cents: null, invalid: true };
  return { cents: Math.round(parseFloat(cleaned) * 100), invalid: false };
}

function proposalSummary(proposal: TripBriefProposal): string {
  const bits: string[] = [];
  if (proposal.tripDescription !== undefined) {
    const text =
      proposal.tripDescription.length > 64
        ? `${proposal.tripDescription.slice(0, 64)}…`
        : proposal.tripDescription;
    bits.push(`“${text || "clear the trip description"}”`);
  }
  if (proposal.budget !== undefined) {
    bits.push(proposal.budget === null ? "clear the budget" : `budget $${(proposal.budget / 100).toFixed(0)}`);
  }
  return bits.join(" · ");
}

export function TripBriefPanel() {
  const brief = useBriefStore((state) => state.brief);
  const save = useBriefStore((state) => state.save);
  const resolve = useBriefStore((state) => state.resolve);

  const [tripInput, setTripInput] = useState("");
  const [budgetInput, setBudgetInput] = useState("");
  const [locationInput, setLocationInput] = useState("");
  const [startInput, setStartInput] = useState("");
  const [endInput, setEndInput] = useState("");
  const [focused, setFocused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);

  // Sync the editor from the store by ADJUSTING STATE DURING RENDER (the
  // React-endorsed pattern) — skipped while the human is mid-edit. The sync
  // key doubles as a change detector so typing isn't clobbered by the poll.
  const contextKey =
    brief === null
      ? "none"
      : `${brief.tripDescription}|${brief.budget ?? "-"}|${brief.location ?? "-"}|${brief.startDate ?? "-"}|${brief.endDate ?? "-"}`;
  const [syncedKey, setSyncedKey] = useState<string | null>(null);
  if (!focused && syncedKey !== contextKey) {
    setSyncedKey(contextKey);
    setTripInput(brief?.tripDescription ?? "");
    setBudgetInput(
      brief?.budgetDollars !== null && brief?.budgetDollars !== undefined ? String(brief.budgetDollars) : "",
    );
    setLocationInput(brief?.location ?? "");
    setStartInput(brief?.startDate ?? "");
    setEndInput(brief?.endDate ?? "");
    setBudgetError(null);
    setDateError(null);
  }

  const dirty =
    tripInput.trim() !== (brief?.tripDescription ?? "") ||
    budgetInput.trim() !==
      (brief?.budgetDollars !== null && brief?.budgetDollars !== undefined ? String(brief.budgetDollars) : "") ||
    locationInput.trim() !== (brief?.location ?? "") ||
    startInput !== (brief?.startDate ?? "") ||
    endInput !== (brief?.endDate ?? "");

  const onSave = async () => {
    const { cents, invalid } = parseBudgetDollars(budgetInput);
    if (invalid) {
      setBudgetError("Use a plain dollar amount, e.g. 400.");
      return;
    }
    if (startInput !== "" && endInput !== "" && startInput > endInput) {
      setDateError("The trip's end date is before its start date.");
      return;
    }
    setBudgetError(null);
    setDateError(null);
    setSaving(true);
    const ok = await save({
      tripDescription: tripInput.trim(),
      budgetCents: cents,
      location: locationInput.trim().length > 0 ? locationInput.trim() : null,
      startDate: startInput !== "" ? startInput : null,
      endDate: endInput !== "" ? endInput : null,
    });
    setSaving(false);
    if (ok) {
      // Logged quietly (no toast — the editor already shows the result) so
      // the agent can see what the human is planning.
      const summary = tripInput.trim().length > 0 ? `“${tripInput.trim().slice(0, 60)}”` : "nothing";
      const budgetBit = cents !== null ? ` · ${cents / 100} dollars` : "";
      const placeBit = locationInput.trim().length > 0 ? ` · ${locationInput.trim().slice(0, 40)}` : "";
      const dateBit = startInput !== "" ? ` · ${startInput} → ${endInput}` : "";
      void logActivity({
        actor: "human",
        action: "update_brief",
        detail: `You set the trip to ${summary}${budgetBit}${placeBit}${dateBit}.`,
        quiet: true,
      });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    }
  };

  const locked = brief?.lockedAt != null;

  return (
    <section aria-label="Trip brief" className="border-b border-line bg-sand/40">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-3 px-4 py-6">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="eyebrow text-rust">The trip</p>
          <p className="text-sm text-ink-soft">
            One line about the trip, plus where and when — your agent reads this before searching,
            placing, or proposing anything, and the weather outlook hangs off the place and dates.
          </p>
          {locked && (
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-paper-raised px-2.5 py-1 text-xs text-ink-soft">
              <Lock aria-hidden="true" className="h-3 w-3" strokeWidth={2} />
              Plan locked — read-only
            </span>
          )}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (dirty && !locked) void onSave();
          }}
          className="flex flex-wrap items-start gap-2"
        >
          <div className="min-w-[240px] flex-1">
            <label htmlFor="trip-description" className="sr-only">
              Trip description
            </label>
            <input
              id="trip-description"
              name="tripDescription"
              type="text"
              value={tripInput}
              onChange={(event) => setTripInput(event.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              maxLength={500}
              readOnly={locked}
              placeholder="e.g. 3-day winter backpacking trip, rainy season"
              className="h-10 w-full rounded-md border border-line-strong bg-paper-raised px-3 text-sm text-ink placeholder:text-ink-faint/70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-rust read-only:opacity-70"
            />
          </div>
          <div className="w-56">
            <label htmlFor="trip-location" className="sr-only">
              Where the trip happens
            </label>
            <input
              id="trip-location"
              name="location"
              type="text"
              value={locationInput}
              onChange={(event) => setLocationInput(event.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              maxLength={160}
              readOnly={locked}
              placeholder="Where — e.g. North Cascades"
              className="h-10 w-full rounded-md border border-line-strong bg-paper-raised px-3 text-sm text-ink placeholder:text-ink-faint/70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-rust read-only:opacity-70"
            />
          </div>
          <div className="w-[9.5rem]">
            <label htmlFor="trip-start" className="sr-only">
              Trip start date
            </label>
            <input
              id="trip-start"
              name="startDate"
              type="date"
              value={startInput}
              onChange={(event) => setStartInput(event.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              readOnly={locked}
              aria-invalid={dateError !== null}
              className="h-10 w-full rounded-md border border-line-strong bg-paper-raised px-2.5 text-sm tabular-nums text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-rust read-only:opacity-70"
            />
          </div>
          <div className="w-[9.5rem]">
            <label htmlFor="trip-end" className="sr-only">
              Trip end date
            </label>
            <input
              id="trip-end"
              name="endDate"
              type="date"
              value={endInput}
              onChange={(event) => setEndInput(event.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              readOnly={locked}
              aria-invalid={dateError !== null}
              className="h-10 w-full rounded-md border border-line-strong bg-paper-raised px-2.5 text-sm tabular-nums text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-rust read-only:opacity-70"
            />
          </div>
          <div className="w-28">
            <label htmlFor="trip-budget" className="sr-only">
              Budget in dollars
            </label>
            <input
              id="trip-budget"
              name="budget"
              type="text"
              inputMode="decimal"
              value={budgetInput}
              onChange={(event) => setBudgetInput(event.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              readOnly={locked}
              placeholder="$ budget"
              aria-invalid={budgetError !== null}
              className="h-10 w-full rounded-md border border-line-strong bg-paper-raised px-3 text-sm tabular-nums text-ink placeholder:text-ink-faint/70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-rust read-only:opacity-70"
            />
          </div>
          <button
            type="submit"
            disabled={!dirty || saving || locked}
            className="h-10 rounded-md bg-ink px-4 text-sm font-medium text-paper transition-colors hover:bg-rust-deep disabled:cursor-default disabled:opacity-35 disabled:hover:bg-ink"
          >
            {saving ? "Saving…" : savedFlash ? "Saved" : "Save trip"}
          </button>
        </form>
        {budgetError && <p className="text-xs text-clay">{budgetError}</p>}
        {dateError && <p className="text-xs text-clay">{dateError}</p>}

        <WeatherChip />

        {brief !== null && brief.pendingProposal !== null ? (
          <ProposalBanner
            title="Agent suggests:"
            onAccept={() => void resolve("accept")}
            onDismiss={() => void resolve("dismiss")}
          >
            {proposalSummary(brief.pendingProposal)}
          </ProposalBanner>
        ) : null}
      </div>
    </section>
  );
}
