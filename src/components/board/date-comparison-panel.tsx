"use client";

import { useState } from "react";
import { Calendar, CheckCircle2, AlertTriangle, CloudSun, History, AlertCircle, ArrowRight, X } from "lucide-react";

import { useBriefStore } from "@/lib/brief-store";
import type { DateRangeComparison } from "@/lib/types";

export function DateComparisonPanel({
  comparisons,
  location,
  onClose,
}: {
  comparisons: DateRangeComparison[];
  location: string | null;
  onClose?: () => void;
}) {
  const brief = useBriefStore((state) => state.brief);
  const saveBrief = useBriefStore((state) => state.save);
  const [appliedRange, setAppliedRange] = useState<string | null>(null);

  if (comparisons.length === 0) return null;

  const onApplyDates = async (startDate: string, endDate: string) => {
    setAppliedRange(`${startDate}:${endDate}`);
    await saveBrief({
      tripDescription: brief?.tripDescription ?? "",
      budgetCents: brief?.budget ?? null,
      location: brief?.location ?? location ?? "",
      startDate,
      endDate,
    });
  };

  return (
    <section
      aria-label="Trip dates comparison"
      className="card-enter mb-6 rounded-md border border-line-strong bg-paper-raised p-4 shadow-sm"
    >
      <div className="flex items-center justify-between border-b border-line pb-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-rust-deep" strokeWidth={1.75} />
          <div>
            <h3 className="font-serif text-lg leading-tight text-ink">Candidate Date Comparison</h3>
            <p className="text-xs text-ink-faint">
              Side-by-side weather and gear readiness preview for {location ?? "your trip destination"}.
            </p>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close date comparison"
            className="rounded-sm p-1 text-ink-faint transition-colors hover:bg-sand hover:text-ink"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {comparisons.map((item, index) => {
          const isCurrent =
            brief?.startDate === item.startDate && brief?.endDate === item.endDate;
          const isJustApplied = appliedRange === `${item.startDate}:${item.endDate}`;

          return (
            <div
              key={`${item.startDate}-${item.endDate}-${index}`}
              className={`flex flex-col justify-between rounded-md border p-3.5 transition-shadow ${
                isCurrent || isJustApplied
                  ? "border-pine/60 bg-pine/[0.02] shadow-xs"
                  : "border-line bg-paper"
              }`}
            >
              <div>
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div>
                    <span className="eyebrow text-ink-faint">
                      {item.label ?? `Option ${String.fromCharCode(65 + index)}`}
                    </span>
                    <h4 className="font-serif text-base leading-snug tracking-tight text-ink">
                      {item.startDate} <span className="text-ink-faint font-sans">→</span> {item.endDate}
                    </h4>
                  </div>
                  {item.weather.dataSource === "forecast" ? (
                    <span className="inline-flex items-center gap-1 rounded-sm bg-pine/10 px-1.5 py-0.5 text-[10px] font-medium text-pine">
                      <CloudSun className="h-3 w-3" />
                      Live Forecast
                    </span>
                  ) : item.weather.dataSource === "historical-average" ? (
                    <span className="inline-flex items-center gap-1 rounded-sm bg-sand px-1.5 py-0.5 text-[10px] font-medium text-ink-soft">
                      <History className="h-3 w-3" />
                      Historical Avg
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-sm bg-clay/10 px-1.5 py-0.5 text-[10px] font-medium text-clay">
                      <AlertCircle className="h-3 w-3" />
                      Unavailable
                    </span>
                  )}
                </div>

                {/* Weather Summary */}
                <div className="mt-3 rounded-sm border border-line/70 bg-sand/40 p-2.5">
                  <p className="text-xs leading-relaxed text-ink-soft">
                    {item.weather.dataSource === "unavailable"
                      ? item.weather.reason
                      : item.weather.summary}
                  </p>
                </div>

                {/* Readiness Summary */}
                <div className="mt-3">
                  <p className="eyebrow text-ink-faint">Readiness Gaps</p>
                  {item.readiness.gaps.length === 0 ? (
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-pine">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      <span>All {item.readiness.totalRequirements} requirements covered</span>
                    </div>
                  ) : (
                    <ul className="mt-1 space-y-1 text-xs text-clay">
                      {item.readiness.gaps.map((gap, gIdx) => (
                        <li key={gIdx} className="flex items-start gap-1.5">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          <span>{gap}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Action Footer */}
              <div className="mt-4 border-t border-line/70 pt-3">
                {isCurrent || isJustApplied ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-pine">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Selected in brief
                  </span>
                ) : (
                  <button
                    onClick={() => void onApplyDates(item.startDate, item.endDate)}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-sm border border-line-strong bg-paper-raised px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:border-ink hover:text-rust-deep"
                  >
                    <span>Use these dates</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
