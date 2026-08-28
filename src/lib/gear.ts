import type { Prisma } from "@/generated/prisma/client";

import { formatCents } from "@/lib/format";
import type {
  BoardItemDTO,
  BoardSummary,
  DayOrderProposal,
  GearItemDTO,
  TripBriefDTO,
  TripBriefProposal,
} from "@/lib/types";

type GearItemRecord = Prisma.GearItemModel;
type BoardItemRecord = Prisma.BoardItemGetPayload<{ include: { gearItem: true } }>;
type TripBriefRecord = Prisma.TripBriefModel;

/**
 * GearItem.tags is stored as a JSON-encoded string (SQLite has no native
 * JSON type). Parsing is defensive: a malformed value degrades to a safe
 * default.
 */
export function parseTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((tag) => typeof tag === "string")) {
      return parsed;
    }
    return [];
  } catch {
    return [];
  }
}

export function toGearDTO(item: GearItemRecord): GearItemDTO {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    price: item.price,
    priceDisplay: formatCents(item.price),
    category: item.category,
    tags: parseTags(item.tags),
    imageUrl: item.imageUrl,
    availability: item.availability,
    // Flavor strings that mean "you can't have this in time" — see the seed.
    available: !/^waitlist|out of stock|gone/i.test(item.availability),
    source: item.source === "owned" ? "owned" : "catalog",
  };
}

export function toBoardItemDTO(item: BoardItemRecord): BoardItemDTO {
  return {
    id: item.id,
    itemType: item.itemType === "day" ? "day" : "gear",
    gearItemId: item.gearItemId,
    name: item.gearItem?.name ?? item.label ?? "Untitled block",
    imageUrl: item.gearItem?.imageUrl ?? null,
    category: item.gearItem?.category ?? null,
    tags: item.gearItem ? parseTags(item.gearItem.tags) : [],
    unitPrice: item.gearItem?.price ?? null,
    priceDisplay: item.gearItem ? formatCents(item.gearItem.price) : null,
    quantity: item.quantity,
    addedBy: (item.addedBy === "agent" ? "agent" : "human") as BoardItemDTO["addedBy"],
    ownership: item.ownership === "owned" ? "owned" : "needed",
    note: item.note ?? null,
    x: item.x,
    y: item.y,
    label: item.label ?? null,
    text: item.text ?? null,
    createdAt: item.createdAt.toISOString(),
  };
}

export function toBoardSummary(
  items: BoardItemRecord[],
  locked: boolean,
  pendingDayOrder: DayOrderProposal | null = null,
): BoardSummary {
  const dtos = items.map(toBoardItemDTO);
  const gear = dtos.filter((item) => item.itemType === "gear");
  // Owned gear does not count toward needed acquisition cost
  const neededGear = gear.filter((item) => item.ownership !== "owned");
  const gearTotalCents = neededGear.reduce(
    (sum, item) => sum + (item.unitPrice ?? 0) * item.quantity,
    0,
  );
  return {
    items: dtos,
    itemCount: gear.length,
    gearTotalCents,
    gearTotalDisplay: formatCents(gearTotalCents),
    locked,
    pendingDayOrder,
  };
}

export function toTripBriefDTO(record: TripBriefRecord, pendingProposal: TripBriefProposal | null): TripBriefDTO {
  return {
    tripDescription: record.tripDescription,
    budget: record.budget,
    budgetDollars: record.budget === null ? null : record.budget / 100,
    budgetDisplay: record.budget === null ? null : formatCents(record.budget),
    location: record.location ?? null,
    startDate: record.startDate === null ? null : record.startDate.toISOString().slice(0, 10),
    endDate: record.endDate === null ? null : record.endDate.toISOString().slice(0, 10),
    updatedBy: record.updatedBy === "agent" ? "agent" : "human",
    updatedAt: record.updatedAt.toISOString(),
    lockedAt: record.lockedAt === null ? null : record.lockedAt.toISOString(),
    pendingProposal,
  };
}
