import { db } from "@/lib/db";
import { toTripBriefDTO } from "@/lib/gear";
import { getProposalPayload, parseBriefProposal } from "@/lib/proposals";
import type { TripBriefDTO } from "@/lib/types";

/**
 * Server-side brief helpers. Every route that returns a TripBriefDTO goes
 * through loadBriefDTO so the pending agent proposal (now living in the
 * generalized Proposal table) is attached consistently.
 */

export async function loadBriefDTO(sessionId: string): Promise<TripBriefDTO | null> {
  const brief = await db.tripBrief.findUnique({ where: { sessionId } });
  if (brief === null) return null;
  const payload = await getProposalPayload(sessionId, "brief");
  return toTripBriefDTO(brief, parseBriefProposal(payload));
}
