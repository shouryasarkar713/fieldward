"use client";

import { Calendar } from "lucide-react";
import { ProposalBanner } from "@/components/proposal-banner";
import { useBoardStore } from "@/lib/board-store";

/**
 * The agent's pending day-block suggestion, rendered above the board —
 * allows the agent to propose route legs / day blocks with mileage and trail notes.
 * The human has 3 choices:
 * - Accept & Add (populated with trail details)
 * - Add as Blank Day (adds title, keeps text blank for human authoring)
 * - Dismiss (drops proposal, adds nothing)
 */
export function DayBlockBanner() {
  const pendingDayBlock = useBoardStore((state) => state.pendingDayBlock);
  const resolveDayBlock = useBoardStore((state) => state.resolveDayBlock);

  if (pendingDayBlock === null) return null;

  return (
    <div data-day-block-banner="pending" className="mb-3">
      <ProposalBanner
        title="Agent suggests adding a day block:"
        onAccept={() => void resolveDayBlock("accept")}
        onSecondary={() => void resolveDayBlock("blank")}
        onDismiss={() => void resolveDayBlock("dismiss")}
        acceptLabel="Accept & Add"
        secondaryLabel="Add as Blank Day"
      >
        <span className="inline-flex flex-wrap items-center gap-1.5 align-baseline">
          <span className="inline-flex items-center gap-1 font-medium text-ink">
            <Calendar aria-hidden="true" className="h-3.5 w-3.5 text-moss-deep" />
            {pendingDayBlock.label}
          </span>
          {pendingDayBlock.text !== null ? (
            <span className="rounded-sm border border-line-strong bg-paper-raised px-1.5 py-0.5 text-xs text-ink-soft">
              {pendingDayBlock.text}
            </span>
          ) : null}
        </span>
        {pendingDayBlock.note !== null ? (
          <span className="block pt-0.5 font-serif text-xs italic leading-snug text-ink-soft">
            “{pendingDayBlock.note}”
          </span>
        ) : null}
      </ProposalBanner>
    </div>
  );
}
