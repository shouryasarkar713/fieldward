/**
 * Trip readiness check — the differentiating feature.
 *
 * A small, deliberately hand-rolled mapping of trip archetypes → the gear
 * categories/tags such a trip usually wants. This is NOT a recommendation
 * engine: it's a checklist the agent (check_trip_readiness tool) and the
 * board's readiness panel share, so both can say "your board doesn't cover X
 * yet" — collaborative refinement toward a goal, not just card-piling.
 *
 * Requirements are phrased against the seeded gear library's real categories
 * and tags, so every gap is always fillable by something in the tray.
 */

export type BoardLineLike = {
  category: string | null;
  tags: string[];
};

type GearRequirement = {
  /** Short label for the UI panel, e.g. "winter-rated sleep system". */
  short: string;
  /** Full gap line for tool output, e.g. "no winter-rated sleep system on the board". */
  gap: string;
  test: (line: BoardLineLike) => boolean;
};

type TripArchetype = {
  /** Human-facing label, e.g. "a winter backpacking trip". */
  label: string;
  keywords: string[];
  requirements: GearRequirement[];
};

const hasTag = (line: BoardLineLike, tag: string) => line.tags.includes(tag);
const inCategory = (line: BoardLineLike, category: string) => line.category === category;

/*
 * Order matters: earlier archetypes win ties, so "winter backpacking" reads
 * as winter (the more specific trip), not plain backpacking.
 */
export const TRIP_ARCHETYPES: TripArchetype[] = [
  {
    label: "a winter backpacking trip",
    keywords: ["winter", "snow", "cold", "alpine", "mountaineering", "freezing", "0°", "20°"],
    requirements: [
      {
        short: "winter-rated sleep system",
        gap: "no winter-rated sleep system on the board",
        test: (line) => inCategory(line, "Shelter") && hasTag(line, "winter-rated"),
      },
      {
        short: "waterproof or winter-rated footwear",
        gap: "no waterproof or winter-rated footwear on the board",
        test: (line) => inCategory(line, "Footwear") && (hasTag(line, "waterproof") || hasTag(line, "winter-rated")),
      },
      {
        short: "a durable pack for the winter load",
        gap: "no durable pack for the winter load on the board",
        test: (line) => inCategory(line, "Backpacks") && (hasTag(line, "winter-rated") || hasTag(line, "durable")),
      },
      {
        short: "cook gear",
        gap: "no cook gear on the board",
        test: (line) => inCategory(line, "Cook Gear"),
      },
    ],
  },
  {
    label: "a wet-weather trip",
    keywords: ["rain", "rainy", "wet", "monsoon", "drizzle", "downpour"],
    requirements: [
      {
        short: "a waterproof pack",
        gap: "no waterproof pack on the board",
        test: (line) => inCategory(line, "Backpacks") && hasTag(line, "waterproof"),
      },
      {
        short: "waterproof footwear",
        gap: "no waterproof footwear on the board",
        test: (line) => inCategory(line, "Footwear") && hasTag(line, "waterproof"),
      },
      {
        short: "a tarp or tent",
        gap: "no tarp or tent on the board",
        test: (line) => inCategory(line, "Shelter"),
      },
    ],
  },
  {
    label: "a backpacking trip",
    keywords: ["backpack", "thru-hike", "thru hike", "hiking", "hike", "trail", "overnight", "trek", "multi-day"],
    requirements: [
      {
        short: "a pack",
        gap: "no pack on the board",
        test: (line) => inCategory(line, "Backpacks"),
      },
      {
        short: "a shelter",
        gap: "no shelter on the board",
        test: (line) => inCategory(line, "Shelter"),
      },
      {
        short: "cook gear",
        gap: "no cook gear on the board",
        test: (line) => inCategory(line, "Cook Gear"),
      },
      {
        short: "trail footwear",
        gap: "no trail footwear on the board",
        test: (line) => inCategory(line, "Footwear"),
      },
    ],
  },
  {
    label: "a day hike",
    keywords: ["day hike", "dayhike", "day trip", "daypack", "light hike", "afternoon walk"],
    requirements: [
      {
        short: "a daypack",
        gap: "no daypack on the board",
        test: (line) => inCategory(line, "Backpacks"),
      },
      {
        short: "trail footwear",
        gap: "no trail footwear on the board",
        test: (line) => inCategory(line, "Footwear"),
      },
    ],
  },
  {
    label: "a camping trip",
    keywords: ["camping", "campground", "campsite", "car camp", "camping trip", "festival"],
    requirements: [
      {
        short: "a tent or tarp",
        gap: "no tent or tarp on the board",
        test: (line) => inCategory(line, "Shelter"),
      },
      {
        short: "a camp kitchen",
        gap: "no camp kitchen on the board",
        test: (line) => inCategory(line, "Cook Gear"),
      },
    ],
  },
];

/** Best keyword match against the trip description; ties go to the earlier archetype. */
export function matchTripArchetype(description: string): TripArchetype | null {
  const text = description.toLowerCase();
  let best: TripArchetype | null = null;
  let bestScore = 0;
  for (const archetype of TRIP_ARCHETYPES) {
    const score = archetype.keywords.filter((keyword) => text.includes(keyword)).length;
    if (score > bestScore) {
      best = archetype;
      bestScore = score;
    }
  }
  return best;
}

export type TripReadinessResult = {
  /** False when no trip description is set or nothing matched. */
  matched: boolean;
  /** Matched archetype label, e.g. "a winter backpacking trip". */
  trip: string | null;
  /** Human-readable gap lines, e.g. "no cook gear on the board". */
  gaps: string[];
  /** Short labels of requirements the board already covers. */
  covered: string[];
  totalRequirements: number;
  gearCards: number;
};

/** Pure: checks a board against the trip description. Shared by the tool and the UI panel. */
export function computeTripReadiness(lines: BoardLineLike[], tripDescription: string): TripReadinessResult {
  const empty = (gearCards: number): TripReadinessResult => ({
    matched: false,
    trip: null,
    gaps: [],
    covered: [],
    totalRequirements: 0,
    gearCards,
  });
  const description = tripDescription.trim();
  if (description.length === 0) {
    return empty(lines.length);
  }
  const archetype = matchTripArchetype(description);
  if (archetype === null) {
    return empty(lines.length);
  }
  const covered: string[] = [];
  const gaps: string[] = [];
  for (const requirement of archetype.requirements) {
    if (lines.some((line) => requirement.test(line))) {
      covered.push(requirement.short);
    } else {
      gaps.push(requirement.gap);
    }
  }
  return {
    matched: true,
    trip: archetype.label,
    gaps,
    covered,
    totalRequirements: archetype.requirements.length,
    gearCards: lines.length,
  };
}
