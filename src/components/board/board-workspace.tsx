"use client";

import { useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CalendarPlus, Lock, UserCheck } from "lucide-react";

import { BoardCanvas } from "@/components/board/board-canvas";
import { LiftedCardBody, TrayDragGhost } from "@/components/board/board-cards";
import { DateComparisonPanel } from "@/components/board/date-comparison-panel";
import { DayOrderBanner } from "@/components/board/day-order-banner";
import { ExportView } from "@/components/board/export-view";
import { GearTray } from "@/components/board/gear-tray";
import { BudgetRollup, ReadinessPanel } from "@/components/board/rail-panels";
import { CARD_WIDTH, clampPosition } from "@/lib/board-geometry";
import { useBoardStore } from "@/lib/board-store";
import { useBriefStore } from "@/lib/brief-store";
import type { BoardItemDTO, GearItemDTO } from "@/lib/types";

/**
 * The workspace: gear tray and status rail on the left, the board on the
 * right — all inside ONE DndContext, because a tray → board drag is a
 * single operation that has to see both endpoints.
 *
 * Drag mechanics (dnd-kit):
 * - board cards are `useDraggable` at their stored (x, y); tray rows are
 *   `useDraggable` with a "tray:"-prefixed id;
 * - the board's visible frame is one `useDroppable` ("board-surface"), so
 *   drops outside the board are simply cancelled;
 * - a DragOverlay carries a lifted clone of the card so the original never
 *   jitters mid-drag;
 * - final positions are computed from the POINTER (activator + delta minus
 *   the board content rect), which stays correct even if the frame is
 *   scrolled mid-drag.
 *
 * And the toolbar carries the one button that matters to the trust
 * boundary: "Lock this plan" is deliberately ordinary — a real click from
 * a human calling POST /api/brief/lock straight from this handler. No
 * WebMCP tool can reach it (asserted in scripts/verify-mcp.ts). While a
 * plan is locked every mutation route answers 409, so even a rogue tool
 * can only read.
 */

const TRAY_PREFIX = "tray:";

type ActiveDrag =
  | { kind: "board"; item: BoardItemDTO; grabOffset: { x: number; y: number } }
  | { kind: "tray"; gear: GearItemDTO }
  | null;

export function BoardWorkspace({ gear }: { gear: GearItemDTO[] }) {
  const items = useBoardStore((state) => state.items);
  const itemCount = useBoardStore((state) => state.itemCount);
  const gearTotalDisplay = useBoardStore((state) => state.gearTotalDisplay);
  const locked = useBoardStore((state) => state.locked);
  const placeGear = useBoardStore((state) => state.placeGear);
  const placeDay = useBoardStore((state) => state.placeDay);
  const moveItem = useBoardStore((state) => state.moveItem);
  const lockPlan = useBriefStore((state) => state.lock);
  const dateComparisons = useBriefStore((state) => state.dateComparisons);
  const setDateComparisons = useBriefStore((state) => state.setDateComparisons);
  const briefLocation = useBriefStore((state) => state.brief?.location);

  const [confirmingLock, setConfirmingLock] = useState(false);
  const [locking, setLocking] = useState(false);
  const [showExport, setShowExport] = useState(true);

  const contentRef = useRef<HTMLDivElement>(null);
  const [activeDrag, setActiveDrag] = useState<ActiveDrag>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const gearById = useMemo(() => new Map(gear.map((item) => [item.id, item])), [gear]);

  /** Pointer position → board coordinates (correct under any scroll offset). */
  const boardPoint = (clientX: number, clientY: number) => {
    const rect = contentRef.current?.getBoundingClientRect();
    if (rect === undefined) return { x: 0, y: 0 };
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const onDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    if (id.startsWith(TRAY_PREFIX)) {
      const gearItem = gearById.get(id.slice(TRAY_PREFIX.length));
      if (gearItem !== undefined) setActiveDrag({ kind: "tray", gear: gearItem });
      return;
    }
    const item = useBoardStore.getState().items.find((entry) => entry.id === id);
    if (item === undefined) return;
    const activator = event.activatorEvent as { clientX?: number; clientY?: number };
    if (activator.clientX === undefined || activator.clientY === undefined) return;
    // Where inside the card the pointer grabbed — so the drop lands where
    // the carried card visually sits, not where its top-left corner is.
    const point = boardPoint(activator.clientX, activator.clientY);
    setActiveDrag({
      kind: "board",
      item,
      grabOffset: { x: point.x - item.x, y: point.y - item.y },
    });
  };

  const onDragEnd = (event: DragEndEvent) => {
    const drag = activeDrag;
    setActiveDrag(null);
    if (drag === null) return;
    if (event.over === null || String(event.over.id) !== "board-surface") return;

    if (drag.kind === "tray") {
      const activator = event.activatorEvent as { clientX?: number; clientY?: number };
      if (activator.clientX === undefined || activator.clientY === undefined) return;
      const drop = boardPoint(activator.clientX + event.delta.x, activator.clientY + event.delta.y);
      // Center the new card under the cursor, biased to its top third.
      const target = clampPosition({
        x: Math.round(drop.x - CARD_WIDTH / 2),
        y: Math.round(drop.y - 48),
      });
      void placeGear({
        gearItemId: drag.gear.id,
        name: drag.gear.name,
        x: target.x,
        y: target.y,
      });
      return;
    }

    if (drag.kind === "board") {
      // Exactly where the human dragged the card: starting (x, y) + delta
      const target = clampPosition({
        x: Math.round(drag.item.x + event.delta.x),
        y: Math.round(drag.item.y + event.delta.y),
      });
      const label =
        drag.item.itemType === "day"
          ? `the ${drag.item.label ?? "day"} block`
          : drag.item.name;
      void moveItem(drag.item.id, target.x, target.y, label);
    }
  };

  const dayCount = items.filter((item) => item.itemType === "day").length;

  const onLock = async () => {
    setLocking(true);
    const ok = await lockPlan();
    setLocking(false);
    if (ok) {
      setConfirmingLock(false);
      setShowExport(true);
    }
  };

  // Locked + export view open (default right after locking).
  if (locked && showExport) {
    return <ExportView onBackToBoard={() => setShowExport(false)} />;
  }

  return (
    <DndContext
      // Stable id: dnd-kit derives every draggable's aria-describedby (and the
      // screen-reader instruction element it points at) from DndContext's id.
      // Without an explicit value it falls back to a module-level counter
      // ("DndDescribedBy-0", "-1", …) that keeps incrementing across SSR
      // renders on a long-lived server while every fresh browser load starts
      // back at 0 — a guaranteed hydration mismatch. A constant keeps server
      // and client in agreement forever; it stays unique because there is
      // exactly one DndContext on the page.
      id="fieldward-board"
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveDrag(null)}
    >
      <section aria-label="Planning workspace" className="mx-auto max-w-[1600px] px-4 pb-16">
        <div className="flex flex-col gap-5 lg:flex-row">
          {/* Rail: tray + status panels */}
          <aside className="flex w-full min-w-0 flex-col gap-4 lg:h-[760px] lg:w-[312px] lg:shrink-0">
            <GearTray gear={gear} locked={locked} />
            <div className="flex flex-col gap-3">
              <BudgetRollup />
              <ReadinessPanel />
            </div>
          </aside>

          {/* Board */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-3">
              <div>
                <h2 className="font-serif text-2xl tracking-tight text-ink">The board</h2>
                <p className="mt-0.5 text-sm text-ink-faint" role="status">
                  {itemCount === 0
                    ? "Empty — drag gear in, or ask your agent to start placing."
                    : `${itemCount} gear card${itemCount === 1 ? "" : "s"} · ${gearTotalDisplay} planned${
                        locked ? " · read-only" : ""
                      }`}
                </p>
              </div>

              <div className="ml-auto flex flex-wrap items-center gap-2">
                {!locked && (
                  <button
                    onClick={() =>
                      void placeDay({
                        label: `Day ${dayCount + 1}`,
                        text: "",
                      })
                    }
                    className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-paper-raised px-3 py-2 text-sm text-ink transition-colors hover:border-ink"
                  >
                    <CalendarPlus aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
                    Day block
                  </button>
                )}

                {/* THE human-only action. No tool path exists — see mcp-tools.ts. */}
                {locked ? (
                  <button
                    onClick={() => setShowExport(true)}
                    className="inline-flex items-center gap-1.5 rounded-md bg-pine px-3 py-2 text-sm font-medium text-paper transition-colors hover:bg-ink"
                  >
                    <Lock aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
                    View the locked plan
                  </button>
                ) : confirmingLock ? (
                  <div className="flex items-center gap-2 rounded-md border border-line-strong bg-paper-raised px-2 py-1.5">
                    <span className="px-1 text-xs text-ink-soft">
                      Lock it? The board becomes read-only and the plan exports.
                    </span>
                    <button
                      onClick={() => void onLock()}
                      disabled={locking}
                      className="rounded-md bg-moss-deep px-3 py-1.5 text-xs font-medium text-paper transition-colors hover:bg-pine disabled:opacity-50"
                    >
                      {locking ? "Locking…" : "Yes, lock it"}
                    </button>
                    <button
                      onClick={() => setConfirmingLock(false)}
                      className="rounded-md border border-line-strong px-3 py-1.5 text-xs text-ink transition-colors hover:border-ink"
                    >
                      Keep planning
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmingLock(true)}
                    disabled={itemCount === 0}
                    className="inline-flex items-center gap-1.5 rounded-md bg-moss-deep px-3 py-2 text-sm font-medium text-paper transition-colors hover:bg-pine disabled:cursor-default disabled:opacity-40"
                  >
                    <Lock aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
                    Lock this plan
                  </button>
                )}
              </div>
            </div>

            <p className="mb-2 flex items-center gap-1.5 text-xs text-ink-faint">
              <UserCheck aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.75} />
              Your agent can place, move, and suggest — but only you can lock the plan.
            </p>

            {dateComparisons && dateComparisons.length > 0 && (
              <DateComparisonPanel
                comparisons={dateComparisons}
                location={briefLocation ?? null}
                onClose={() => setDateComparisons(null)}
              />
            )}

            <DayOrderBanner />

            <div id="board-frame">
              <BoardCanvas contentRef={contentRef} locked={locked} />
            </div>
          </div>
        </div>
      </section>

      <DragOverlay dropAnimation={null}>
        {activeDrag === null ? null : activeDrag.kind === "tray" ? (
          <TrayDragGhost gear={activeDrag.gear} lifted />
        ) : (
          <LiftedCardBody item={activeDrag.item} locked={locked} />
        )}
      </DragOverlay>
    </DndContext>
  );
}
