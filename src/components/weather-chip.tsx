"use client";

import { useEffect } from "react";
import { CloudOff, CloudSun, History, Loader2 } from "lucide-react";

import { useBriefStore } from "@/lib/brief-store";
import { useWeatherStore } from "@/lib/weather-store";
import { incompleteOutlookReason } from "@/lib/weather";

/**
 * The weather summary chip in the trip-brief panel — the human-side answer to
 * the agent's get_weather_outlook tool, reading the same server route (and
 * therefore the same cached upstream call).
 *
 * Honesty is the design constraint: the chip ALWAYS labels which of the three
 * states it's showing — a real forecast, a seasonal average, or not available
 * (with the reason) — so "real forecast" and "rough seasonal guess" can never
 * be mistaken for each other. That label is what makes the rest of the
 * weather-grounded copy trustworthy.
 */
export function WeatherChip() {
  const brief = useBriefStore((state) => state.brief);
  const outlook = useWeatherStore((state) => state.outlook);
  const loading = useWeatherStore((state) => state.loading);
  const refresh = useWeatherStore((state) => state.refresh);

  // Refresh when the place/dates window changes (poll-driven brief updates
  // flow through here too — the effect key covers both).
  const location = brief?.location ?? null;
  const startDate = brief?.startDate ?? null;
  const endDate = brief?.endDate ?? null;
  useEffect(() => {
    void refresh();
  }, [location, startDate, endDate, refresh]);

  const locked = brief?.lockedAt != null;
  const missingReason = incompleteOutlookReason(location, startDate, endDate);
  const hasWindow = missingReason === null;

  // ── Not yet available: place or dates missing (or swapped) ──────────────
  if (!hasWindow) {
    return (
      <div
        data-weather-state="unset"
        aria-label="Weather outlook"
        className="flex items-start gap-2 rounded-md border border-line bg-paper-raised px-3 py-2"
      >
        <CloudOff aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={1.75} />
        <p className="flex-1 text-xs leading-relaxed text-ink-faint">{missingReason}</p>
        <ChipLabel tone="muted">Not yet available</ChipLabel>
      </div>
    );
  }

  // ── Fetching (or re-fetching) the window's outlook ──────────────────────
  if (outlook === null) {
    return (
      <div
        data-weather-state="loading"
        aria-label="Weather outlook"
        className="flex items-center gap-2 rounded-md border border-line bg-paper-raised px-3 py-2"
      >
        <Loader2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 animate-spin text-ink-faint" strokeWidth={1.75} />
        <p className="flex-1 text-xs leading-relaxed text-ink-faint">Checking the outlook for those dates…</p>
      </div>
    );
  }

  if (outlook.dataSource === "unavailable") {
    return (
      <div
        data-weather-state="unavailable"
        aria-label="Weather outlook"
        className="flex items-start gap-2 rounded-md border border-line bg-paper-raised px-3 py-2"
      >
        <CloudOff aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" strokeWidth={1.75} />
        <p className="flex-1 text-xs leading-relaxed text-ink-soft">{outlook.reason}</p>
        <ChipLabel tone="muted">Not available</ChipLabel>
      </div>
    );
  }

  if (outlook.dataSource === "forecast") {
    return (
      <div
        data-weather-state="forecast"
        aria-label="Weather outlook"
        className="flex items-start gap-2 rounded-md border border-moss/40 bg-moss/10 px-3 py-2"
      >
        <CloudSun aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-moss-deep" strokeWidth={1.75} />
        <p className="flex-1 text-xs leading-relaxed text-ink-soft">
          <span className="font-medium text-ink">
            {outlook.location.name}
            {outlook.location.region !== null ? `, ${outlook.location.region}` : ""}
          </span>{" "}
          — {outlook.summary}
          {loading ? <span className="text-ink-faint"> Refreshing…</span> : null}
        </p>
        <ChipLabel tone="moss">Real forecast</ChipLabel>
      </div>
    );
  }

  return (
    <div
      data-weather-state="historical-average"
      aria-label="Weather outlook"
      className="flex items-start gap-2 rounded-md border border-rust/30 bg-rust/5 px-3 py-2"
    >
      <History aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rust" strokeWidth={1.75} />
      <p className="flex-1 text-xs leading-relaxed text-ink-soft">
        <span className="font-medium text-ink">
          {outlook.location.name}
          {outlook.location.region !== null ? `, ${outlook.location.region}` : ""}
        </span>{" "}
        — {outlook.summary} Averaged over {outlook.sampledYears} past year{outlook.sampledYears === 1 ? "" : "s"}; the
        real forecast unlocks about two weeks out.
        {locked ? null : <span className="text-ink-faint"> The readiness check leans on this too.</span>}
      </p>
      <ChipLabel tone="rust">Seasonal average</ChipLabel>
    </div>
  );
}

function ChipLabel({ tone, children }: { tone: "moss" | "rust" | "muted"; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    moss: "border-moss/40 bg-paper-raised text-moss-deep",
    rust: "border-rust/30 bg-paper-raised text-rust",
    muted: "border-line bg-sand/60 text-ink-faint",
  };
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
