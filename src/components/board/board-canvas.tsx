"use client";

import { useDroppable, useDraggable } from "@dnd-kit/core";

import { CheckCircle2, Compass, PackageCheck } from "lucide-react";

import { DayCardBody, GearCardBody } from "@/components/board/board-cards";
import { BOARD_HEIGHT, BOARD_WIDTH, OWNED_ZONE_BOUNDARY_Y } from "@/lib/board-geometry";
import { useBoardStore } from "@/lib/board-store";
import type { BoardItemDTO } from "@/lib/types";

/**
 * The board surface — a fixed 2400×1600 canvas inside a scrolling frame.
 * Cards render at their stored (x, y) as absolutely-positioned wrappers
 * (dnd-kit draggables) around presentational card bodies.
 *
 * The DndContext itself lives one level up in BoardWorkspace so the gear
 * tray (source of tray → board drags) shares the same drag operation.
 * Coordinates are converted against `contentRef`, passed down from the
 * workspace so both the drop handler and the canvas agree on the board's
 * origin under any scroll offset.
 */

/** A board card wrapped in its draggable shell, pinned at (x, y). */
function DraggableBoardCard({ item, locked }: { item: BoardItemDTO; locked: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: item.id,
    disabled: locked,
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...(locked ? {} : listeners)}
      className={`card-enter absolute left-0 top-0 ${locked ? "cursor-default" : "cursor-grab touch-none active:cursor-grabbing"} ${
        isDragging ? "z-30 opacity-35" : ""
      }`}
      style={{
        ["--card-x" as string]: `${item.x}px`,
        ["--card-y" as string]: `${item.y}px`,
        transform: `translate3d(${item.x}px, ${item.y}px, 0)`,
        // The settle transition: agent moves glide; human drops land instantly and smoothly
        transition: isDragging ? "none" : "transform 250ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        zIndex: isDragging ? 30 : item.itemType === "day" ? 5 : undefined,
      }}
    >
      {item.itemType === "day" ? (
        <DayCardBody item={item} locked={locked} />
      ) : (
        <GearCardBody item={item} locked={locked} />
      )}
    </div>
  );
}

export function BoardCanvas({
  contentRef,
  locked,
}: {
  /** Ref to the 2400×1600 content div — the board's coordinate origin. */
  contentRef: React.RefObject<HTMLDivElement | null>;
  locked: boolean;
}) {
  const items = useBoardStore((state) => state.items);
  const { setNodeRef: setDropRef } = useDroppable({ id: "board-surface" });

  return (
    <div
      ref={setDropRef}
      role="application"
      aria-label="Trip planning board — drag cards to arrange the trip"
      className="thin-scroll h-[560px] overflow-auto rounded-md border border-line bg-sand/40 lg:h-[680px]"
    >
      <div ref={contentRef} className="board-grid relative" style={{ width: BOARD_WIDTH, height: BOARD_HEIGHT }}>
        {/* Visual Zone: Top Lane ("Already Have / Owned") */}
        <div
          className="pointer-events-none absolute left-0 top-0 w-full border-b border-dashed border-pine/35 bg-pine/[0.035]"
          style={{ height: OWNED_ZONE_BOUNDARY_Y }}
        />
        
        {/* Lane Header 1: Already Have */}
        <div className="pointer-events-none absolute left-12 top-4 flex select-none items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-pine/30 bg-paper-raised/90 px-3 py-1 text-xs font-medium text-pine shadow-2xs">
            <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
            Already Have (Owned)
          </span>
          <span className="text-xs text-ink-faint">
            Gear you own · Satisfies readiness checklist with $0 budget spend
          </span>
        </div>

        {/* Route Spine Guide: Left column boundary below top lane */}
        <div
          className="pointer-events-none absolute border-r border-dashed border-line/70"
          style={{
            left: 320,
            top: OWNED_ZONE_BOUNDARY_Y,
            height: BOARD_HEIGHT - OWNED_ZONE_BOUNDARY_Y,
          }}
        />

        {/* Lane Header 2: Route Spine & To Pack */}
        <div
          className="pointer-events-none absolute left-12 flex select-none items-center gap-2.5"
          style={{ top: OWNED_ZONE_BOUNDARY_Y + 16 }}
        >
          <span className="inline-flex items-center gap-1.5 rounded-full border border-rust/30 bg-paper-raised/90 px-3 py-1 text-xs font-medium text-rust shadow-2xs">
            <Compass className="h-3.5 w-3.5" strokeWidth={2} />
            Route Itinerary Spine
          </span>
          <span className="text-xs text-ink-faint">
            Day blocks sequence (left) · Pack & gear staging (right)
          </span>
        </div>

        {items.length === 0 && (
          <div className="absolute left-48 top-48 max-w-md">
            <p className="font-serif text-2xl leading-snug tracking-tight text-ink-soft">
              An empty board, a whole trip.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-ink-faint">
              Drag gear in from the tray, add a day block or two, and let your agent do
              the searching — everything it places lands here, live, with its reasoning
              beside it.
            </p>
          </div>
        )}
        {items.map((item) => (
          <DraggableBoardCard key={item.id} item={item} locked={locked} />
        ))}
      </div>
    </div>
  );
}
