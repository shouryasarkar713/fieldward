-- Fieldward round 4: weather grounding + generalized pending proposals.
--
-- Two changes, both additive in spirit:
-- 1. TripBrief gains the human's factual trip inputs (location, startDate,
--    endDate) — the grounding for the weather outlook and, through it, the
--    readiness check.
-- 2. The pending-proposal mechanism generalizes from a bespoke
--    TripBrief.proposalJson column into its own Proposal table keyed by
--    (sessionId, kind), so trip-brief updates AND day-order suggestions use
--    the same propose → human-accepts/dismisses mechanism. Any pending brief
--    proposals are carried across, then the old column is dropped.

-- TripBrief: where and when the trip happens.
ALTER TABLE "TripBrief" ADD COLUMN "location" TEXT;
ALTER TABLE "TripBrief" ADD COLUMN "startDate" DATETIME;
ALTER TABLE "TripBrief" ADD COLUMN "endDate" DATETIME;

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Proposal_sessionId_kind_key" UNIQUE ("sessionId", "kind")
);

-- CreateIndex
CREATE INDEX "Proposal_sessionId_idx" ON "Proposal"("sessionId");

-- Data: carry any PENDING brief proposals into the generalized table.
-- (Only pending suggestions ever lived in proposalJson — accepted values
-- were merged into the live brief fields long ago, so nothing else moves.)
INSERT INTO "Proposal" ("id", "sessionId", "kind", "payloadJson", "createdAt")
SELECT lower(hex(randomblob(16))), "sessionId", 'brief', "proposalJson",
       strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')
FROM "TripBrief"
WHERE "proposalJson" IS NOT NULL;

-- DropColumn
ALTER TABLE "TripBrief" DROP COLUMN "proposalJson";
