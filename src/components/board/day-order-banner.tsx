"use client";

import { ArrowRight } from "lucide-react";

import { ProposalBanner } from "@/components/proposal-banner";
import { useBoardStore } from "@/lib/board-store";

/**
 * The agent's pending day-order suggestion, rendered above the board it
 * would rearrange — the same banner pattern (and the same Proposal table
 * row, kind "day-order") as trip-brief proposals. The sequence is spelled
 * out with the human's own day labels so accepting is an informed call:
 * nothing on the board moves until the Accept click applies it by slot
 * reassignment (the blocks glide to their new reading order).
 */
export function DayOrderBanner() {
  const pendingDayOrder = useBoardStore((state) => state.pendingDayOrder);
  const items = useBoardStore((state) => state.items);
  const resolveDayOrder = useBoardStore((state) => state.resolveDayOrder);

  if (pendingDayOrder === null) return null;

  const labelFor = (id: string): string => {
    const item = items.find((entry) => entry.id === id);
    if (item === undefined) return "(a block that's gone)";
    const label = item.label ?? "Untitled block";
    return label.length > 30 ? `${label.slice(0, 30)}…` : label;
  };

  return (
    <div data-day-order-banner="pending" className="mb-3">
      <ProposalBanner
        title="Agent suggests a new day order:"
        onAccept={() => void resolveDayOrder("accept")}
        onDismiss={() => void resolveDayOrder("dismiss")}
        acceptLabel="Accept order"
      >
        <span className="inline-flex flex-wrap items-center gap-1 align-baseline">
          {pendingDayOrder.orderedBoardItemIds.map((id, index) => (
            <span key={id} className="inline-flex items-center gap-1">
              {index > 0 ? (
                <ArrowRight aria-hidden="true" className="h-3 w-3 text-ink-faint" strokeWidth={2} />
              ) : null}
              <span className="rounded-sm border border-line-strong bg-paper-raised px-1.5 py-0.5 text-xs text-ink">
                {labelFor(id)}
              </span>
            </span>
          ))}
        </span>
        {pendingDayOrder.note !== null ? (
          <span className="block pt-0.5 font-serif text-xs italic leading-snug text-ink-soft">
            “{pendingDayOrder.note}”
          </span>
        ) : null}
      </ProposalBanner>
    </div>
  );
}
