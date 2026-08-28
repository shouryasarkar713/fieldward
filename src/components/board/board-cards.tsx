"use client";

import Link from "next/link";
import Image from "next/image";
import { Bot, GripVertical, MapPin, Minus, Plus, User, X } from "lucide-react";

import { useBoardStore } from "@/lib/board-store";
import type { BoardItemDTO, GearItemDTO } from "@/lib/types";

/**
 * Presentational board cards — no drag logic here. The canvas renders these
 * inside draggable wrappers and inside dnd-kit's DragOverlay (with `lifted`
 * styling), so the card you carry looks exactly like the card you dropped.
 *
 * Interactive children (buttons, links, inputs) swallow pointer-down events
 * so clicking them never starts a card drag.
 */

export const swallowPointer = {
  onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
};

/** Caption marking who placed a card — the heart of the human+agent demo. */
function AddedByCaption({ addedBy }: { addedBy: BoardItemDTO["addedBy"] }) {
  if (addedBy === "agent") {
    return (
      <p className="mt-1 flex items-center gap-1 text-[11px] text-moss-deep">
        <Bot aria-hidden="true" className="h-3 w-3" strokeWidth={1.75} />
        Placed by agent
      </p>
    );
  }
  return (
    <p className="mt-1 flex items-center gap-1 text-[11px] text-ink-faint">
      <User aria-hidden="true" className="h-3 w-3" strokeWidth={1.75} />
      Placed by you
    </p>
  );
}

/**
 * The agent's first-person reasoning for a pick — distinct from the
 * attribution caption above it. Set as italic serif with a thin moss rule:
 * the agent speaks, but in the board's editorial voice. No chat-bubble
 * styling, no emoji — this is a note on a trip plan, not a message.
 */
function AgentNote({ note }: { note: string }) {
  return (
    <p className="mt-1.5 border-l-2 border-moss/60 pl-2 font-serif text-xs italic leading-snug text-ink-soft">
      {note}
    </p>
  );
}

type CardBodyProps = {
  item: BoardItemDTO;
  locked: boolean;
};

/** A gear card on the board: thumbnail, name, price, quantity, attribution, note. */
export function GearCardBody({ item, locked }: CardBodyProps) {
  const updateQuantity = useBoardStore((state) => state.updateQuantity);
  const removeItem = useBoardStore((state) => state.removeItem);
  const busy = useBoardStore((state) => state.busyItemIds.includes(item.id));
  const constrained = item.unitPrice !== null && item.name !== null;

  return (
    <article
      aria-label={`${item.name}${item.quantity > 1 ? ` ×${item.quantity}` : ""}`}
      className={`w-56 select-none rounded-md border border-line bg-paper-raised p-3 shadow-sm ${
        busy ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-sm border border-line bg-sand">
          {item.imageUrl !== null && (
            <Image
              src={item.imageUrl}
              alt=""
              fill
              sizes="64px"
              className="object-cover"
              draggable={false}
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="eyebrow text-ink-faint">{item.category}</p>
          <h4 className="mt-0.5 font-serif text-sm leading-snug tracking-tight text-ink">
            {/* No pointer opt-out on the link: a clean click navigates, a
                press-and-move drags the card (dnd-kit's 6px activation). */}
            <Link href={`/gear/${item.gearItemId}`} draggable={false} className="hover:text-rust-deep">
              {item.name}
            </Link>
          </h4>
          {constrained && (
            <p className="mt-0.5 text-xs tabular-nums text-ink-soft">
              {item.priceDisplay}
              {item.quantity > 1 && <span className="text-ink-faint"> × {item.quantity}</span>}
            </p>
          )}
        </div>
        <span aria-hidden="true" className="mt-0.5 text-ink-faint/60">
          <GripVertical className="h-3.5 w-3.5" strokeWidth={1.75} />
        </span>
      </div>

      {!locked && (
        <div className="mt-2 flex items-center justify-between">
          <div className="inline-flex items-center rounded-md border border-line-strong">
            <button
              {...swallowPointer}
              onClick={() => void updateQuantity(item.id, item.quantity - 1)}
              disabled={item.quantity <= 1}
              aria-label={`Decrease ${item.name} quantity`}
              className="flex h-6 w-6 items-center justify-center text-ink-soft transition-colors hover:text-ink disabled:opacity-30"
            >
              <Minus aria-hidden="true" className="h-3 w-3" strokeWidth={2} />
            </button>
            <span className="w-7 text-center text-xs tabular-nums" aria-live="polite">
              {item.quantity}
            </span>
            <button
              {...swallowPointer}
              onClick={() => void updateQuantity(item.id, item.quantity + 1)}
              aria-label={`Increase ${item.name} quantity`}
              className="flex h-6 w-6 items-center justify-center text-ink-soft transition-colors hover:text-ink"
            >
              <Plus aria-hidden="true" className="h-3 w-3" strokeWidth={2} />
            </button>
          </div>
          <button
            {...swallowPointer}
            onClick={() => void removeItem(item.id)}
            aria-label={`Remove ${item.name} from the board`}
            className="rounded-sm p-1 text-ink-faint transition-colors hover:bg-sand hover:text-clay"
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
      )}

      <div className="mt-1.5 border-t border-line/70 pt-1.5">
        <AddedByCaption addedBy={item.addedBy} />
        {item.note !== null && item.note.length > 0 && <AgentNote note={item.note} />}
      </div>
    </article>
  );
}

/** A route/day card on the board — the human's structure; the agent arranges around it. */
export function DayCardBody({ item, locked }: CardBodyProps) {
  const updateDay = useBoardStore((state) => state.updateDay);
  const removeItem = useBoardStore((state) => state.removeItem);

  return (
    <article
      aria-label={item.label ?? "Day block"}
      className="w-56 select-none rounded-md border border-pine/25 bg-sand/80 p-3 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <p className="eyebrow flex items-center gap-1 text-pine/70">
          <MapPin aria-hidden="true" className="h-3 w-3" strokeWidth={2} />
          Route
        </p>
        <span aria-hidden="true" className="text-ink-faint/60">
          <GripVertical className="h-3.5 w-3.5" strokeWidth={1.75} />
        </span>
      </div>

      <input
        {...swallowPointer}
        value={item.label ?? ""}
        readOnly={locked}
        onChange={(event) => useBoardStore.getState().applyLocalLabelEdit(item.id, event.target.value)}
        onBlur={(event) => {
          if (!locked && event.target.value.trim() !== (item.label ?? "")) {
            void updateDay(item.id, event.target.value.trim() || "Day", item.text ?? "");
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        maxLength={120}
        aria-label="Day label"
        className="mt-1 w-full rounded-sm bg-transparent font-serif text-base leading-snug tracking-tight text-ink outline-none focus-visible:bg-paper-raised focus-visible:px-1"
      />

      <input
        {...swallowPointer}
        value={item.text ?? ""}
        readOnly={locked}
        onChange={(event) => useBoardStore.getState().applyLocalTextEdit(item.id, event.target.value)}
        onBlur={(event) => {
          if (!locked && event.target.value !== (item.text ?? "")) {
            void updateDay(item.id, item.label ?? "Day", event.target.value);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        maxLength={280}
        placeholder="e.g. 6 mi · 1,900 ft gain · camp at Cairn Lake"
        aria-label="Day notes"
        className="mt-0.5 w-full rounded-sm bg-transparent text-xs text-ink-soft outline-none placeholder:text-ink-faint/60 focus-visible:bg-paper-raised focus-visible:px-1"
      />

      {!locked && (
        <div className="mt-1.5 flex justify-end border-t border-pine/15 pt-1.5">
          <button
            {...swallowPointer}
            onClick={() => void removeItem(item.id)}
            aria-label={`Remove the ${item.label ?? "day"} block`}
            className="rounded-sm p-1 text-ink-faint transition-colors hover:bg-paper-raised hover:text-clay"
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
      )}
    </article>
  );
}

/** The ghost that follows the cursor while dragging a tray item onto the board. */
export function TrayDragGhost({ gear, lifted = false }: { gear: GearItemDTO; lifted?: boolean }) {
  return (
    <article
      aria-hidden="true"
      className={`w-56 select-none rounded-md border border-line bg-paper-raised p-3 shadow-sm ${
        lifted ? "rotate-1 scale-[1.03] shadow-xl ring-2 ring-rust/50" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-sm border border-line bg-sand">
          <Image src={gear.imageUrl} alt="" fill sizes="64px" className="object-cover" draggable={false} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="eyebrow text-ink-faint">{gear.category}</p>
          <h4 className="mt-0.5 font-serif text-sm leading-snug tracking-tight text-ink">{gear.name}</h4>
          <p className="mt-0.5 text-xs tabular-nums text-ink-soft">{gear.priceDisplay}</p>
        </div>
      </div>
      <p className="mt-2 border-t border-line/70 pt-1.5 text-[11px] text-ink-faint">
        Dropping onto the board…
      </p>
    </article>
  );
}

/** Lifted presentation of an existing card inside the DragOverlay. */
export function LiftedCardBody({ item, locked }: CardBodyProps) {
  return (
    <div className="rotate-1 scale-[1.03]">
      {item.itemType === "day" ? (
        <DayCardBody item={item} locked={locked} />
      ) : (
        <GearCardBody item={item} locked={locked} />
      )}
    </div>
  );
}
