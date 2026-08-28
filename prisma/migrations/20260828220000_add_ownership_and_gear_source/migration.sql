-- Add source to GearItem (catalog vs owned)
ALTER TABLE "GearItem" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'catalog';

-- Add ownership to BoardItem (needed vs owned)
ALTER TABLE "BoardItem" ADD COLUMN "ownership" TEXT NOT NULL DEFAULT 'needed';
