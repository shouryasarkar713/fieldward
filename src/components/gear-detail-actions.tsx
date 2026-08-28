"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LayoutDashboard, Minus, Plus } from "lucide-react";

import { useBoardStore } from "@/lib/board-store";
import type { GearItemDTO } from "@/lib/types";

/**
 * Quantity stepper + place button for the gear detail page (human path).
 * Places the item at the server-chosen next open slot — the same default
 * placement the place_on_board tool gets — then heads back to the board so
 * the placement is visible.
 */
export function GearDetailActions({ gear }: { gear: GearItemDTO }) {
  const placeGear = useBoardStore((state) => state.placeGear);
  const [quantity, setQuantity] = useState(1);
  const [placing, setPlacing] = useState(false);
  const router = useRouter();

  const onPlace = async () => {
    setPlacing(true);
    const ok = await placeGear({ gearItemId: gear.id, name: gear.name, quantity });
    setPlacing(false);
    if (ok) router.push("/#board-frame");
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <div className="inline-flex items-center rounded-md border border-line-strong bg-paper-raised">
          <button
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            disabled={quantity <= 1}
            aria-label="Decrease quantity"
            className="flex h-11 w-10 items-center justify-center text-ink-soft transition-colors hover:text-ink disabled:opacity-30"
          >
            <Minus aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
          </button>
          <span className="w-8 text-center text-sm tabular-nums" aria-live="polite">
            {quantity}
          </span>
          <button
            onClick={() => setQuantity((q) => Math.min(20, q + 1))}
            aria-label="Increase quantity"
            className="flex h-11 w-10 items-center justify-center text-ink-soft transition-colors hover:text-ink"
          >
            <Plus aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        <button
          onClick={() => void onPlace()}
          disabled={placing}
          className="flex-1 rounded-md bg-ink px-4 py-3 text-sm font-medium text-paper transition-colors hover:bg-rust-deep disabled:opacity-60"
        >
          {placing ? "Placing…" : "Place on the board"}
          {quantity > 1 ? ` · × ${quantity}` : ""}
        </button>
      </div>
      <Link
        href="/#board-frame"
        className="inline-flex items-center justify-center gap-1.5 text-xs text-ink-faint underline-offset-2 transition-colors hover:text-ink hover:underline"
      >
        <LayoutDashboard aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.75} />
        Back to the board
      </Link>
    </div>
  );
}
