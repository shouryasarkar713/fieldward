import { isBoardLocked } from "@/lib/board-server";
import { putProposal, serializeDayBlockProposal } from "@/lib/proposals";
import { errorResponse, optionalString, readJsonBody, requireString } from "@/lib/validate";

/**
 * POST /api/board/day-block/propose
 * Body: { sessionId, label, text?, note? }
 *
 * The AGENT's path (called by the propose_day_block WebMCP tool).
 * Proposes adding a single day block with trail notes / mileage / elevation.
 * Nothing is added to the board directly: stored as a pending proposal (kind "day-block")
 * that the human can Accept (with details), Add as Blank, or Dismiss in the UI.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return errorResponse(400, bodyResult.error);
    const body = bodyResult.value;

    const sessionId = await requireString(body, "sessionId", { max: 100 });
    if (!sessionId.ok) return errorResponse(400, sessionId.error);

    if (await isBoardLocked(sessionId.value)) {
      return errorResponse(409, "This plan is locked — the board is read-only.");
    }

    const label = await requireString(body, "label", { max: 120 });
    if (!label.ok) return errorResponse(400, label.error);

    const text = await optionalString(body, "text", { max: 280 });
    if (!text.ok) return errorResponse(400, text.error);

    const note = await optionalString(body, "note", { max: 280 });
    if (!note.ok) return errorResponse(400, note.error);

    const proposal = {
      label: label.value,
      text: text.value ?? null,
      note: note.value ?? null,
    };

    await putProposal(sessionId.value, "day-block", serializeDayBlockProposal(proposal));

    return Response.json({ proposal });
  } catch (error) {
    console.error("[api/board/day-block/propose]", error);
    return errorResponse(500, "Something went wrong proposing that day block.");
  }
}
