import { db } from "@/lib/db";
import { toBoardItemDTO, toBoardSummary } from "@/lib/gear";
import { clampPosition, nextOpenOwnedPosition, nextOpenPosition } from "@/lib/board-geometry";
import type { BoardItemDTO } from "@/lib/types";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Server-side board helpers shared by the REST routes (which the human UI
 * calls) and the WebMCP tools (which call these same routes). The one rule
 * that matters: while the human has locked the plan, nothing moves.
 */

export async function isBoardLocked(sessionId: string): Promise<boolean> {
  const brief = await db.tripBrief.findUnique({ where: { sessionId } });
  return brief?.lockedAt !== null && brief !== null;
}

export async function loadBoardItems(sessionId: string) {
  return db.boardItem.findMany({
    where: { sessionId },
    include: { gearItem: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function loadBoardSummary(sessionId: string): Promise<BoardItemDTO[]> {
  const [items, locked] = await Promise.all([
    loadBoardItems(sessionId),
    isBoardLocked(sessionId),
  ]);
  return toBoardSummary(items, locked).items;
}

/**
 * Resolve a position for a new card: use the caller's x/y (clamped) or scan
 * for the next open slot in the appropriate zone server-side.
 */
export function resolveNewPosition(
  x: number | undefined,
  y: number | undefined,
  occupied: { x: number; y: number }[],
  ownership: "owned" | "needed" = "needed",
): { x: number; y: number } {
  if (x !== undefined && y !== undefined && Number.isFinite(x) && Number.isFinite(y)) {
    return clampPosition({ x, y });
  }
  return ownership === "owned" ? nextOpenOwnedPosition(occupied) : nextOpenPosition(occupied);
}

export function boardItemInclude(): Prisma.BoardItemInclude {
  return { gearItem: true };
}

export { toBoardItemDTO };
