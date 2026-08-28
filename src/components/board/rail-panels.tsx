"use client";

import { useMemo } from "react";
import { CircleCheck, Compass, Wallet } from "lucide-react";

import { useBoardStore } from "@/lib/board-store";
import { useBriefStore } from "@/lib/brief-store";
import { computeTripReadiness } from "@/lib/trip-readiness";
import { mergeReadinessWithWeather } from "@/lib/weather";
import { useWeatherStore } from "@/lib/weather-store";

/**
 * The rail's two quiet status panels:
 *
 * - BudgetRollup: planned gear total vs the brief's budget. Derived, never
 *   stored — TripBrief owns the budget, the board owns the totals, this
 *   panel just holds them next to each other.
 * - ReadinessPanel: the same pure trip-readiness check the agent's
 *   check_trip_readiness tool runs, weather fold included, so human and
 *   agent always agree on what's missing — one coherent result, not a
 *   trip-type list plus a separate weather list to reconcile. Non-nagging
 *   by design: hidden when there's nothing to say, one line when there is.
 */

export function BudgetRollup() {
  const gearTotalCents = useBoardStore((state) => state.gearTotalCents);
  const itemCount = useBoardStore((state) => state.itemCount);
  const brief = useBriefStore((state) => state.brief);

  const budgetCents = brief?.budget ?? null;
  const overBudget = budgetCents !== null && gearTotalCents > budgetCents;
  const progress =
    budgetCents === null || budgetCents === 0
      ? null
      : Math.min(100, Math.round((gearTotalCents / budgetCents) * 100));

  return (
    <section
      aria-label="Budget roll-up"
      className="rounded-md border border-line bg-paper-raised px-3.5 py-3"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow flex items-center gap-1.5 text-ink-faint">
          <Wallet aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.75} />
          Planned
        </p>
        <p className="text-sm tabular-nums">
          <span className={`font-medium ${overBudget ? "text-clay" : "text-ink"}`}>
            ${(gearTotalCents / 100).toFixed(2)}
          </span>
          {budgetCents !== null && (
            <span className="text-ink-faint"> of ${(budgetCents / 100).toFixed(2)}</span>
          )}
        </p>
      </div>

      {progress !== null && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-sand" role="presentation">
          <div
            className={`h-full rounded-full transition-all duration-500 ${overBudget ? "bg-clay" : "bg-moss"}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
        {itemCount === 0
          ? "Nothing on the board yet."
          : budgetCents === null
            ? `${itemCount} gear card${itemCount === 1 ? "" : "s"} — set a budget in the trip brief to see the line.`
            : overBudget
              ? `Over budget by $${((gearTotalCents - budgetCents) / 100).toFixed(2)} — the agent can suggest swaps.`
              : `$${((budgetCents - gearTotalCents) / 100).toFixed(2)} still under the line.`}
      </p>
    </section>
  );
}

export function ReadinessPanel() {
  const items = useBoardStore((state) => state.items);
  const brief = useBriefStore((state) => state.brief);
  const outlook = useWeatherStore((state) => state.outlook);

  const result = useMemo(() => {
    if (brief === null) return null;
    const base = computeTripReadiness(items, brief.tripDescription);
    // Same fold the tool runs: weather-driven gaps (rain, freezing nights)
    // land next to the trip-type gaps — when place and dates are set.
    const weatherOutlook =
      outlook ?? ({ dataSource: "unavailable", reason: "no place and dates yet" } as const);
    return mergeReadinessWithWeather(base, weatherOutlook, items);
  }, [items, brief, outlook]);

  // Nothing matched and the weather has nothing to say either → stay quiet.
  if (result === null || (!result.matched && result.gaps.length === 0)) return null;

  if (result.gaps.length === 0) {
    return (
      <section
        aria-label="Trip readiness"
        className="rounded-md border border-moss/40 bg-moss/10 px-3.5 py-2.5"
      >
        <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-soft">
          <CircleCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-moss-deep" strokeWidth={1.75} />
          <span>
            <span className="font-medium text-moss-deep">The board covers {result.trip}.</span>{" "}
            <span className="text-ink-faint">Nothing missing.</span>
          </span>
        </p>
      </section>
    );
  }

  const short = result.gaps.map((gap) => gap.replace(/^no /, "").replace(/ on the board$/, ""));

  return (
    <section
      aria-label="Trip readiness"
      className="rounded-md border border-line bg-sand/50 px-3.5 py-2.5"
    >
      <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-soft">
        <Compass aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-rust" strokeWidth={1.75} />
        <span>
          <span className="font-medium text-ink">Still missing:</span> {short.join(", ")}
          <span className="text-ink-faint"> — your agent can find options.</span>
        </span>
      </p>
    </section>
  );
}
