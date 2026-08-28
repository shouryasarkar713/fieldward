"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

import type { GearItemDTO } from "@/lib/types";

/**
 * Header search with a live dropdown. Debounced calls to /api/gear/search —
 * the same endpoint the WebMCP search_gear tool uses, just driven by a
 * keyboard.
 */
export function SearchBox() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GearItemDTO[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/gear/search?q=${encodeURIComponent(trimmed)}&limit=5`,
          { cache: "no-store" },
        );
        if (response.ok) {
          const body = (await response.json()) as { results: GearItemDTO[] };
          setResults(body.results);
          setOpen(true);
        }
      } catch {
        // Fail quietly — search is a convenience, not a critical path.
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const go = (id: string) => {
    setOpen(false);
    setQuery("");
    router.push(`/gear/${id}`);
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-xs sm:max-w-sm">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "Enter" && results[0] !== undefined) go(results[0].id);
          }}
          placeholder="Search the gear library…"
          aria-label="Search gear"
          aria-expanded={open}
          aria-controls="search-results-listbox"
          aria-autocomplete="list"
          role="combobox"
          className="h-9 w-full rounded-md border border-line-strong bg-paper-raised pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-rust"
        />
      </div>

      {open && (
        <div
          id="search-results-listbox"
          role="listbox"
          aria-label="Search results"
          className="thin-scroll absolute left-0 right-0 top-11 z-50 max-h-96 overflow-y-auto rounded-md border border-line bg-paper-raised shadow-md"
        >
          {loading && results.length === 0 && (
            <p className="px-3 py-3 text-sm text-ink-faint">Searching…</p>
          )}
          {!loading && results.length === 0 && query.trim().length >= 2 && (
            <p className="px-3 py-3 text-sm text-ink-faint">
              Nothing in the library for that. Try “boots” or “stove”.
            </p>
          )}
          {results.map((gear) => (
            <button
              key={gear.id}
              role="option"
              aria-selected={false}
              onClick={() => go(gear.id)}
              className="flex w-full items-center gap-3 border-b border-line px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-sand"
            >
              <img
                src={gear.imageUrl}
                alt=""
                className="h-10 w-10 rounded-sm border border-line object-cover"
                loading="lazy"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{gear.name}</span>
                <span className="block text-xs text-ink-faint">{gear.category}</span>
              </span>
              <span className="text-sm text-ink-soft">{gear.priceDisplay}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
