import { db } from "@/lib/db";
import { toBoardSummary } from "@/lib/gear";
import { isBoardLocked, loadBoardItems, resolveNewPosition } from "@/lib/board-server";
import { clearProposal, getProposalPayload, parseDayBlockProposal, parseDayOrderProposal } from "@/lib/proposals";
import { errorResponse, readJsonBody, requireString } from "@/lib/validate";

/**
 * POST /api/board/day-block/resolve
 * Body: { sessionId, decision: "accept" | "blank" | "dismiss" }
 *
 * The HUMAN's verdict on a pending day-block proposal (kind "day-block"):
 * - "accept": Creates the day block on the board populated with proposed trail notes.
 * - "blank": Creates the day block on the board with an empty description for human customization.
 * - "dismiss": Discards the proposal with no item added to the board.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return errorResponse(400, bodyResult.error);
    const body = bodyResult.value;

    const sessionId = await requireString(body, "sessionId", { max: 100 });
    if (!sessionId.ok) return errorResponse(400, sessionId.error);

    const decision = body.decision;
    if (decision !== "accept" && decision !== "blank" && decision !== "dismiss") {
      return errorResponse(400, 'Field "decision" must be "accept", "blank", or "dismiss".');
    }

    if (await isBoardLocked(sessionId.value)) {
      return errorResponse(409, "This plan is locked — the board is read-only.");
    }

    const proposal = parseDayBlockProposal(await getProposalPayload(sessionId.value, "day-block"));
    if (proposal === null) {
      return errorResponse(404, "No pending day-block proposal to resolve.");
    }

    if (decision === "dismiss") {
      await clearProposal(sessionId.value, "day-block");
      return boardResponse(sessionId.value, null);
    }

    const existing = await loadBoardItems(sessionId.value);
    const position = resolveNewPosition(undefined, undefined, existing.map((i) => ({ x: i.x, y: i.y })));

    const created = await db.boardItem.create({
      data: {
        sessionId: sessionId.value,
        itemType: "day",
        label: proposal.label,
        text: decision === "accept" ? proposal.text : null,
        addedBy: "human",
        note: proposal.note,
        x: position.x,
        y: position.y,
      },
      include: { gearItem: true },
    });

    await clearProposal(sessionId.value, "day-block");
    return boardResponse(sessionId.value, created.id);
  } catch (error) {
    console.error("[api/board/day-block/resolve]", error);
    return errorResponse(500, "Something went wrong resolving that day block proposal.");
  }
}

async function boardResponse(sessionId: string, createdItemId: string | null): Promise<Response> {
  const [items, locked, dayOrderPayload, dayBlockPayload] = await Promise.all([
    loadBoardItems(sessionId),
    isBoardLocked(sessionId),
    getProposalPayload(sessionId, "day-order"),
    getProposalPayload(sessionId, "day-block"),
  ]);
  return Response.json({
    createdItemId,
    ...toBoardSummary(
      items,
      locked,
      parseDayOrderProposal(dayOrderPayload),
      parseDayBlockProposal(dayBlockPayload),
    ),
  });
}
