"use client";

import { Bot, Sparkles, X } from "lucide-react";

/**
 * The pending-proposal banner — the ONE visual pattern for every consequential
 * thing the agent suggests (trip-brief updates, day orders, and whatever
 * domain comes next). The agent proposes; nothing changes until this banner's
 * human clicks Accept or Dismiss.
 *
 * Extracted from the trip-brief panel when day orders became the second
 * proposal domain — the mechanism generalized into the Proposal table, and
 * the banner generalized with it.
 */
export function ProposalBanner({
  title,
  children,
  onAccept,
  onSecondary,
  onDismiss,
  acceptLabel = "Accept",
  secondaryLabel,
  dismissLabel = "Dismiss",
}: {
  /** Lead-in, e.g. "Agent suggests:" — rendered with the spark icon. */
  title: string;
  /** The suggestion itself — plain copy or structured chips. */
  children: React.ReactNode;
  onAccept: () => void;
  onSecondary?: () => void;
  onDismiss: () => void;
  acceptLabel?: string;
  secondaryLabel?: string;
  dismissLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-moss/40 bg-moss/10 px-3.5 py-2.5">
      <Bot aria-hidden="true" className="h-4 w-4 shrink-0 text-moss-deep" strokeWidth={1.75} />
      <p className="min-w-[200px] flex-1 text-sm leading-snug text-ink-soft">
        <span className="inline-flex items-center gap-1 font-medium text-moss-deep">
          <Sparkles aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.75} />
          {title}
        </span>{" "}
        {children}
        <span className="text-ink-faint"> — your call, nothing changes until you accept.</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onAccept}
          className="rounded-md bg-moss-deep px-3 py-1.5 text-xs font-medium text-paper transition-colors hover:bg-pine"
        >
          {acceptLabel}
        </button>
        {onSecondary !== undefined && secondaryLabel !== undefined ? (
          <button
            onClick={onSecondary}
            className="rounded-md border border-moss/60 bg-paper-raised px-3 py-1.5 text-xs font-medium text-moss-deep transition-colors hover:bg-moss/10"
          >
            {secondaryLabel}
          </button>
        ) : null}
        <button
          onClick={onDismiss}
          className="flex items-center gap-1.5 rounded-md border border-line-strong bg-paper-raised px-3 py-1.5 text-xs text-ink transition-colors hover:border-ink"
        >
          <X aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
          {dismissLabel}
        </button>
      </div>
    </div>
  );
}
