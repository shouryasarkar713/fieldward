-- Fieldward pivot: storefront → shared trip-planning board.
--
-- Deliberately destructive: the commerce tables (Product/CartItem/Order/
-- ShoppingContext) are dropped and rebuilt as planning tables
-- (GearItem/BoardItem/TripBrief). The database is a demo artifact with an
-- idempotent seed, so no data is carried across.

DROP TABLE IF EXISTS "CartItem";
DROP TABLE IF EXISTS "Order";
DROP TABLE IF EXISTS "Product";
DROP TABLE IF EXISTS "ShoppingContext";

-- CreateTable
CREATE TABLE "GearItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "tags" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "availability" TEXT NOT NULL DEFAULT 'In stock'
);

-- CreateTable
CREATE TABLE "BoardItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "gearItemId" TEXT,
    "label" TEXT,
    "text" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "addedBy" TEXT NOT NULL,
    "note" TEXT,
    "x" REAL NOT NULL,
    "y" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BoardItem_gearItemId_fkey" FOREIGN KEY ("gearItemId") REFERENCES "GearItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TripBrief" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "tripDescription" TEXT NOT NULL DEFAULT '',
    "budget" INTEGER,
    "proposalJson" TEXT,
    "lockedAt" DATETIME,
    "updatedBy" TEXT NOT NULL DEFAULT 'human',
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "TripBrief_sessionId_key" ON "TripBrief"("sessionId");

-- CreateIndex
CREATE INDEX "BoardItem_sessionId_idx" ON "BoardItem"("sessionId");
