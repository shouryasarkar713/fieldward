"use client";

import Link from "next/link";
import Image from "next/image";
import { useMemo, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { Plus, Search } from "lucide-react";

import { useBoardStore } from "@/lib/board-store";
import { CATEGORIES, type Category, type GearItemDTO } from "@/lib/types";

/**
 * The gear tray — the board's supply shelf. Draggable rows the human pulls
 * onto the board (dnd-kit: each row is a `useDraggable` with a "tray:" id
 * the canvas understands), plus a + button that places at the server-chosen
 * next open slot for anyone who'd rather click than drag. Searchable and
 * category-filtered client-side — at 28 items the whole library is already
 * in memory, so filtering is instant.
 */

const TRAY_PREFIX = "tray:";

function TrayRow({ gear, locked }: { gear: GearItemDTO; locked: boolean }) {
  const placeGear = useBoardStore((state) => state.placeGear);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${TRAY_PREFIX}${gear.id}`,
    disabled: locked,
  });

  return (
    <li
      ref={setNodeRef}
      {...attributes}
      {...(locked ? {} : listeners)}
      className={`group flex items-center gap-3 rounded-md border border-line bg-paper-raised px-2.5 py-2 shadow-sm transition-shadow ${
        locked ? "cursor-default" : "cursor-grab touch-none hover:shadow-md active:cursor-grabbing"
      } ${isDragging ? "opacity-35" : ""}`}
      aria-label={`${gear.name}, ${gear.priceDisplay} — drag onto the board`}
    >
      {/* Links don't swallow the pointer: a clean click navigates, a
          press-and-move starts the drag (dnd-kit's 6px activation). Only
          the + button opts out — it's a discrete action. */}
      <Link
        href={`/gear/${gear.id}`}
        draggable={false}
        className="relative h-11 w-11 shrink-0 overflow-hidden rounded-sm border border-line bg-sand"
        aria-label={`View ${gear.name} details`}
      >
        <Image src={gear.imageUrl} alt={gear.name} fill sizes="44px" className="object-cover" draggable={false} />
      </Link>

      <div className="min-w-0 flex-1">
        <Link
          href={`/gear/${gear.id}`}
          draggable={false}
          className="block truncate font-serif text-sm leading-snug tracking-tight text-ink hover:text-rust-deep"
        >
          {gear.name}
        </Link>
        <p className="mt-0.5 flex items-baseline gap-1.5 text-xs">
          <span className="tabular-nums text-ink-soft">{gear.priceDisplay}</span>
          {gear.availability !== "In stock" && (
            <span className="truncate text-rust" title={gear.availability}>
              {gear.availability}
            </span>
          )}
        </p>
      </div>

      <button
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() =>
          void placeGear({ gearItemId: gear.id, name: gear.name }).then(() =>
            // Scroll the board into view so the placement is visible — the
            // card lands at the next open slot, near the top-left.
            document.getElementById("board-frame")?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
          )
        }
        disabled={locked}
        aria-label={`Place ${gear.name} on the board`}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line-strong bg-paper text-ink transition-colors hover:border-ink hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
      </button>
    </li>
  );
}

export function GearTray({ gear, locked }: { gear: GearItemDTO[]; locked: boolean }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category | "All">("All");

  const visible = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter((term) => term.length > 0);
    return gear.filter((item) => {
      if (category !== "All" && item.category !== category) return false;
      if (terms.length === 0) return true;
      const haystack = `${item.name} ${item.category} ${item.tags.join(" ")}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [gear, query, category]);

  return (
    <section aria-label="Gear tray" className="flex min-h-0 flex-1 flex-col rounded-md border border-line bg-paper-raised">
      <div className="border-b border-line px-3 py-3">
        <p className="eyebrow text-ink-faint">The gear tray</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-faint">
          Drag onto the board, or use + to drop it at the next open spot.
        </p>
        <div className="relative mt-2">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the tray…"
            aria-label="Search gear in the tray"
            className="h-9 w-full rounded-md border border-line-strong bg-paper pl-8 pr-3 text-sm text-ink placeholder:text-ink-faint/70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-rust"
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(["All", ...CATEGORIES] as const).map((name) => (
            <button
              key={name}
              onClick={() => setCategory(name)}
              aria-pressed={category === name}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                category === name
                  ? "border-ink bg-ink text-paper"
                  : "border-line bg-transparent text-ink-soft hover:border-ink hover:text-ink"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      <ul className="thin-scroll flex-1 space-y-2 overflow-y-auto p-2.5">
        {visible.map((item) => (
          <TrayRow key={item.id} gear={item} locked={locked} />
        ))}
        {visible.length === 0 && (
          <li className="px-2 py-6 text-center text-sm text-ink-faint">
            Nothing in the tray for that.
          </li>
        )}
      </ul>
    </section>
  );
}
