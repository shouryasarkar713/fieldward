"use client";

import Link from "next/link";
import { Tent } from "lucide-react";

import { SearchBox } from "@/components/search-box";
import { useMcpStatusStore } from "@/lib/mcp-status";

/** Registration-state pill for the WebMCP tool surface. */
function McpStatusPill() {
  const status = useMcpStatusStore((state) => state.status);
  const toolCount = useMcpStatusStore((state) => state.toolCount);

  const dotClass =
    status === "active" ? "bg-moss" : status === "checking" ? "bg-line-strong" : "bg-ink-faint";
  const label =
    status === "active"
      ? `Agent tools · ${toolCount}`
      : status === "checking"
        ? "Agent tools…"
        : "Agent tools n/a";

  return (
    <span
      title={
        status === "active"
          ? "WebMCP tools registered — an AI agent in this browser can search gear, place cards, arrange the board, and propose brief updates."
          : "No WebMCP model context in this browser — agent tools are not registered."
      }
      className="hidden items-center gap-1.5 rounded-full border border-line bg-paper-raised px-2.5 py-1 text-xs text-ink-soft md:inline-flex"
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
      {label}
    </span>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 print-hidden">
      {/* Announcement strip — carries the demo's one-liner about the boundary. */}
      <div className="bg-pine px-4 py-1.5 text-center text-xs text-paper/90">
        A shared planning board: your agent searches, places, and arranges — locking the
        plan stays yours.
      </div>

      <div className="border-b border-line bg-paper/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-3 px-4 sm:gap-5">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2 text-ink transition-opacity hover:opacity-80"
            aria-label="Fieldward home"
          >
            <Tent aria-hidden="true" className="h-5 w-5 text-rust" strokeWidth={1.75} />
            <span className="font-serif text-2xl leading-none tracking-tight">Fieldward</span>
          </Link>

          <div className="flex flex-1 justify-end sm:justify-center">
            <SearchBox />
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <McpStatusPill />
            <Link
              href="/#board-frame"
              className="hidden rounded-md border border-line bg-paper-raised px-3 py-2 text-sm text-ink transition-colors hover:border-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rust sm:inline-flex"
            >
              Go to the board
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
