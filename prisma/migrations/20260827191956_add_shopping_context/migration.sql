-- CreateTable
CREATE TABLE "ShoppingContext" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "tripDescription" TEXT NOT NULL DEFAULT '',
    "budget" INTEGER,
    "updatedBy" TEXT NOT NULL DEFAULT 'human',
    "updatedAt" DATETIME NOT NULL,
    "revertAvailable" BOOLEAN NOT NULL DEFAULT false,
    "revertTripDescription" TEXT NOT NULL DEFAULT '',
    "revertBudget" INTEGER
);

-- CreateIndex
CREATE UNIQUE INDEX "ShoppingContext_sessionId_key" ON "ShoppingContext"("sessionId");
