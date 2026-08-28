"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Bot, Lock, Printer, RotateCcw } from "lucide-react";

import { useBoardStore } from "@/lib/board-store";
import { useBriefStore } from "@/lib/brief-store";
import { CATEGORIES } from "@/lib/types";

/**
 * The export view — what locking the plan unlocks. A clean, printable
 * packing list and day-by-day itinerary built from the board as it stood at
 * lock time (the board is frozen, so this is always consistent).
 *
 * Day blocks read in board order — sorted top-to-bottom, then left-to-right —
 * so the spatial arrangement the human and agent settled on IS the itinerary
 * order. A small touch that makes the board more than decoration.
 */

export function ExportView({ onBackToBoard }: { onBackToBoard: () => void }) {
  const items = useBoardStore((state) => state.items);
  const gearTotalCents = useBoardStore((state) => state.gearTotalCents);
  const brief = useBriefStore((state) => state.brief);
  const reset = useBriefStore((state) => state.reset);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  const lockedAt = brief?.lockedAt ?? null;
  const budgetCents = brief?.budget ?? null;
  const overBudget = budgetCents !== null && gearTotalCents > budgetCents;

  const days = items
    .filter((item) => item.itemType === "day")
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const gear = items.filter((item) => item.itemType === "gear");
  const byCategory = CATEGORIES.map((category) => ({
    category,
    items: gear.filter((item) => item.category === category),
  })).filter((group) => group.items.length > 0);
  const agentPicks = gear.filter((item) => item.addedBy === "agent").length;

  return (
    <section aria-label="Locked plan summary" className="mx-auto max-w-3xl px-4 py-10">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-6">
        <div>
          <p className="eyebrow flex items-center gap-1.5 text-moss-deep">
            <Lock aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
            The plan, locked
          </p>
          <h2 className="mt-2 font-serif text-3xl tracking-tight text-ink">
            {brief !== null && brief.tripDescription.length > 0 ? brief.tripDescription : "The trip"}
          </h2>
          <p className="mt-1 text-sm text-ink-faint">
            {lockedAt !== null &&
              `Locked ${new Date(lockedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} · by you, the human`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-ink-soft">
            <span className={`font-medium tabular-nums ${overBudget ? "text-clay" : "text-ink"}`}>
              ${(gearTotalCents / 100).toFixed(2)}
            </span>
            {budgetCents !== null && (
              <span className="text-ink-faint"> of ${(budgetCents / 100).toFixed(2)}</span>
            )}{" "}
            planned
          </p>
          <p className="mt-0.5 text-xs text-ink-faint">
            {gear.length} item{gear.length === 1 ? "" : "s"} · {agentPicks} picked by your agent
          </p>
        </div>
      </header>

      {days.length > 0 && (
        <section aria-label="Itinerary" className="mt-8">
          <h3 className="font-serif text-xl tracking-tight text-ink">The days</h3>
          <ol className="mt-3 space-y-2.5">
            {days.map((day, index) => (
              <li
                key={day.id}
                className="flex items-baseline gap-3 rounded-md border border-line bg-paper-raised px-4 py-3 print-plain"
              >
                <span className="font-serif text-lg tabular-nums text-rust">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-serif text-base leading-snug tracking-tight text-ink">
                    {day.label}
                  </p>
                  {day.text !== null && day.text.length > 0 && (
                    <p className="mt-0.5 text-sm text-ink-soft">{day.text}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section aria-label="Packing list" className="mt-8">
        <h3 className="font-serif text-xl tracking-tight text-ink">The packing list</h3>
        {byCategory.length === 0 ? (
          <p className="mt-3 text-sm text-ink-faint">No gear on the board when the plan was locked.</p>
        ) : (
          <div className="mt-3 space-y-5">
            {byCategory.map(({ category, items: group }) => (
              <div key={category}>
                <p className="eyebrow text-ink-faint">{category}</p>
                <ul className="mt-2 divide-y divide-line rounded-md border border-line bg-paper-raised print-plain">
                  {group.map((item) => (
                    <li key={item.id} className="flex items-start gap-3 px-4 py-2.5">
                      {item.imageUrl !== null && (
                        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-sm border border-line bg-sand">
                          <Image
                            src={item.imageUrl}
                            alt=""
                            fill
                            sizes="40px"
                            className="object-cover"
                            draggable={false}
                          />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-ink">
                          {item.gearItemId !== null ? (
                            <Link href={`/gear/${item.gearItemId}`} className="hover:text-rust-deep">
                              {item.name}
                            </Link>
                          ) : (
                            item.name
                          )}
                          {item.quantity > 1 && (
                            <span className="text-ink-faint"> × {item.quantity}</span>
                          )}
                        </p>
                        {item.note !== null && item.note.length > 0 && (
                          <p className="mt-0.5 border-l-2 border-moss/60 pl-2 font-serif text-xs italic leading-snug text-ink-soft">
                            {item.note}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        {item.priceDisplay !== null && (
                          <p className="text-sm tabular-nums text-ink-soft">{item.priceDisplay}</p>
                        )}
                        {item.addedBy === "agent" && (
                          <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-moss-deep">
                            <Bot aria-hidden="true" className="h-3 w-3" strokeWidth={1.75} />
                            agent
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <footer className="mt-10 flex flex-wrap items-center gap-3 border-t border-line pt-6 print-hidden">
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-md bg-moss-deep px-4 py-2.5 text-sm font-medium text-paper transition-colors hover:bg-pine"
        >
          <Printer aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
          Print / save as PDF
        </button>
        <button
          onClick={onBackToBoard}
          className="inline-flex items-center gap-2 rounded-md border border-line-strong bg-paper-raised px-4 py-2.5 text-sm text-ink transition-colors hover:border-ink"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
          Back to the board
        </button>
        <div className="ml-auto">
          {confirmingReset ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-soft">Wipe this plan and start fresh?</span>
              <button
                onClick={async () => {
                  setResetting(true);
                  const ok = await reset();
                  setResetting(false);
                  if (ok) setConfirmingReset(false);
                }}
                disabled={resetting}
                className="rounded-md bg-clay px-3 py-1.5 text-xs font-medium text-paper transition-colors hover:bg-rust-deep disabled:opacity-50"
              >
                {resetting ? "Starting…" : "Yes, start over"}
              </button>
              <button
                onClick={() => setConfirmingReset(false)}
                className="rounded-md border border-line-strong bg-paper-raised px-3 py-1.5 text-xs text-ink transition-colors hover:border-ink"
              >
                Keep it
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmingReset(true)}
              className="inline-flex items-center gap-1.5 text-xs text-ink-faint underline-offset-2 transition-colors hover:text-clay hover:underline"
            >
              <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.75} />
              Start a new plan
            </button>
          )}
        </div>
      </footer>
    </section>
  );
}
