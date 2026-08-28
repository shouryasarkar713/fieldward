import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "node:path";

import { PrismaClient } from "../src/generated/prisma/client";

/**
 * Seeds the Fieldward gear library: 28 items across four categories.
 *
 * Run with: npm run db:seed   (or bun run db:seed)
 * Idempotent: skips when the library already has gear, unless
 * FORCE_SEED=1. Set FORCE_SEED=1 to wipe and reseed.
 *
 * Image URLs are direct Unsplash CDN links (verified live before shipping —
 * see scripts/check-final-images.mjs; photo content verified against the
 * official Unsplash Lite dataset descriptions).
 */

type SeedGear = {
  name: string;
  description: string;
  price: number; // cents — reference cost for the board's budget roll-up
  category: "Backpacks" | "Footwear" | "Shelter" | "Cook Gear";
  tags: string[];
  imageUrl: string;
  availability: string; // flavor text, not a count — see schema.prisma
};

const img = (id: string) => `https://images.unsplash.com/${id}?q=80&w=1200&auto=format&fit=crop`;

const GEAR: SeedGear[] = [
  // ── Backpacks ────────────────────────────────────────────────────────────
  {
    name: "Ridgeline 45L Pack",
    description:
      "The pack we reach for when the trip could go anywhere. A 210D ripstop body, a floating lid, and a removable framesheet for gram-counting days. The harness carries 35 pounds comfortably and disappears when you cinch it down.",
    price: 18_900,
    category: "Backpacks",
    tags: ["featured", "ultralight", "durable"],
    imageUrl: img("photo-1553062407-98eeb64c6a62"),
    availability: "In stock",
  },
  {
    name: "Cairn 65L Expedition Pack",
    description:
      "Built for long carries and worse weather: a 500D Cordura base, a removable lid that becomes a summit pack, and a harness that stays friendly at fifty pounds. The one we would take for a week above treeline.",
    price: 27_900,
    category: "Backpacks",
    tags: ["durable", "winter-rated"],
    imageUrl: img("photo-1510353157186-4e5fec7beb6d"),
    availability: "In stock",
  },
  {
    name: "Alpenglow 28L Daypack",
    description:
      "A clean 28-liter daypack with a roll-top and one sneaky feature: a hipbelt pocket that actually fits a modern phone. Our default for shoulder-season day hikes and long overdue summit picnics.",
    price: 11_900,
    category: "Backpacks",
    tags: ["waterproof", "beginner-friendly"],
    imageUrl: img("photo-1440186347098-386b7459ad6b"),
    availability: "In stock",
  },
  {
    name: "Treeline 55L Pack",
    description:
      "The Ridgeline's sibling, with a harness cut for narrower shoulders and a shorter torso range. Same fabric, same carry, better fit for a lot of people. The next run lands in March — the waitlist is open.",
    price: 20_900,
    category: "Backpacks",
    tags: ["ultralight", "durable"],
    imageUrl: img("photo-1476297820623-03984cf5cdbb"),
    availability: "Waitlist until March",
  },
  {
    name: "Portage 30L Dry Pack",
    description:
      "Welded seams, a roll-top storm collar, and not a single zipper below the waterline. Made for paddling days, drizzle weeks, and keeping the sleeping bag dry no matter how the forecast swings.",
    price: 13_900,
    category: "Backpacks",
    tags: ["waterproof", "durable"],
    imageUrl: img("photo-1542317279-72571d7a779a"),
    availability: "Low stock — 4 left",
  },
  {
    name: "Squirrelly 12L Running Vest",
    description:
      "Twelve liters of bounce-free storage for fast days: two soft flasks, a pole quiver, and mesh that doesn't swamp you in August. Fits like a shirt, carries like a pack.",
    price: 8_900,
    category: "Backpacks",
    tags: ["ultralight", "gift-worthy"],
    imageUrl: img("photo-1501555088652-021faa106b9b"),
    availability: "In stock",
  },
  {
    name: "Baseline 22L Commuter Pack",
    description:
      "An honest pack at an honest price. Padded laptop sleeve, bottle pockets that hold their shape, and fabric that shrugs off a drizzle. No bells, no whistles, no regrets.",
    price: 6_900,
    category: "Backpacks",
    tags: ["budget", "travel"],
    imageUrl: img("photo-1496055024442-2606697dee3d"),
    availability: "In stock",
  },

  // ── Footwear ─────────────────────────────────────────────────────────────
  {
    name: "Talus GTX Hiking Boots",
    description:
      "Full-grain leather uppers, a waterproof bootie, and a lacing system that locks the heel where it belongs. The boot for trails that never quite dry out — broken in by mile three, not month three.",
    price: 22_900,
    category: "Footwear",
    tags: ["waterproof", "durable"],
    imageUrl: img("photo-1576760994270-85335a1c613c"),
    availability: "In stock",
  },
  {
    name: "Switchback Trail Runners",
    description:
      "A 9.4-ounce trail shoe with just enough rock plate to keep the fun fun. Breaks in on the first run, drains fast after creek crossings, and grips like a rumor on wet slab.",
    price: 13_900,
    category: "Footwear",
    tags: ["ultralight", "beginner-friendly"],
    imageUrl: img("photo-1600185365483-26d7a4cc7519"),
    availability: "In stock",
  },
  {
    name: "Granite Peak Mountaineering Boots",
    description:
      "Fully rigid, crampon-compatible, and insulated for minus-thirty overnights. Sized to wear with thick expedition socks — go a half size up if you run narrow.",
    price: 39_900,
    category: "Footwear",
    tags: ["winter-rated", "durable"],
    imageUrl: img("photo-1556912743-90a361c19b16"),
    availability: "Low stock — 3 pairs left",
  },
  {
    name: "Drifter Canvas Camp Shoes",
    description:
      "The shoe you leave by the tent door. A waxable canvas upper, a squashy EVA midsole, and it packs flat to nothing. Equally beloved at crag bases and backyard fires.",
    price: 5_900,
    category: "Footwear",
    tags: ["budget", "gift-worthy"],
    imageUrl: img("photo-1422728221357-57980993ea99"),
    availability: "In stock",
  },
  {
    name: "Fen Suede Moc Boots",
    description:
      "Camp mocs on a real crepe sole — warm around the fire, good on the lodge porch, and casual enough for the drive home. The shoe people borrow constantly and never return.",
    price: 11_900,
    category: "Footwear",
    tags: ["gift-worthy", "beginner-friendly"],
    imageUrl: img("photo-1547919307-39751fd99411"),
    availability: "In stock",
  },
  {
    name: "Traverse Approach Shoes",
    description:
      "Sticky climbing rubber up front, a hiker's heart underneath, and enough edging power for the scramble section. The one-shoe answer to alpine link-ups and long walk-offs.",
    price: 14_900,
    category: "Footwear",
    tags: ["durable", "ultralight"],
    imageUrl: img("photo-1549298916-b41d501d3772"),
    availability: "In stock",
  },
  {
    name: "Mire Rubber Rain Boots",
    description:
      "Hand-laid rubber over a soft jersey lining. Insanely good in the mud room, on the dock, or on the walk to the trailhead when the lot has become a swamp. Pull tabs that work with cold hands.",
    price: 9_900,
    category: "Footwear",
    tags: ["waterproof", "budget"],
    imageUrl: img("photo-1489031394173-5112ea733006"),
    availability: "Low stock — 5 pairs left",
  },

  // ── Shelter ──────────────────────────────────────────────────────────────
  {
    name: "Hollowpine 2P Tent",
    description:
      "Two doors, two vestibules, and a 3.1-pound packed weight for the pair of you. The mesh canopy earns its keep in bug season, and the fly tapes out drum-tight before a squall.",
    price: 34_900,
    category: "Shelter",
    tags: ["ultralight", "durable"],
    imageUrl: img("photo-1504280390367-361c6d9f38f4"),
    availability: "In stock",
  },
  {
    name: "Lonetree Solo Shelter",
    description:
      "A 22-ounce trekking-pole shelter that pitches in four minutes and shrugs off ridge wind. Half tent, half tarp, all minimalist — for people who count ounces and stars.",
    price: 25_900,
    category: "Shelter",
    tags: ["ultralight"],
    imageUrl: img("photo-1510312305653-8ed496efae75"),
    availability: "Low stock — 4 left",
  },
  {
    name: "Basecamp 4P Tent",
    description:
      "Standing height, color-coded poles, and a 75D floor that doesn't blink at gravel. Goes up in ten minutes on the first try, with the whole family supervising from camp chairs.",
    price: 42_900,
    category: "Shelter",
    tags: ["durable", "beginner-friendly"],
    imageUrl: img("photo-1533873984035-25970ab07461"),
    availability: "In stock",
  },
  {
    name: "Nightfall 20° Sleeping Bag",
    description:
      "650-fill recycled down, a contoured hood, and a draft collar that actually works. True to its rating — we've slept it at fifteen in the Cascades and never once thought about the cold.",
    price: 21_900,
    category: "Shelter",
    tags: ["winter-rated"],
    imageUrl: img("photo-1543362137-396c385ae95d"),
    availability: "In stock",
  },
  {
    name: "Mosslight 40° Quilt",
    description:
      "The quilt argument at its simplest: nineteen ounces, a sewn footbox, and pad attachments that don't fight you at 2 a.m. Summer trips and gram counters, meet your match.",
    price: 17_900,
    category: "Shelter",
    tags: ["ultralight", "budget"],
    imageUrl: img("photo-1508873696983-2dfd5898f08b"),
    availability: "In stock",
  },
  {
    name: "Cedar Grove Double Sleeping Bag",
    description:
      "A roomy double for car-camp couples, with a fold-back layer for warm nights and a full-length draft tube for cold ones. Unzips into two singles the day the dog claims it.",
    price: 18_900,
    category: "Shelter",
    tags: ["gift-worthy", "beginner-friendly"],
    imageUrl: img("photo-1537905569824-f89f14cceb68"),
    availability: "Low stock — 6 left",
  },
  {
    name: "Harbor Tarp 10×12",
    description:
      "A silnylon rectangle with sixteen guy points that stuffs to the size of a Nalgene. The most versatile shelter we carry: kitchen roof, rainy-day living room, windy-beach backup plan.",
    price: 8_900,
    category: "Shelter",
    tags: ["budget", "durable"],
    imageUrl: img("photo-1478131143081-80f7f84ca84d"),
    availability: "In stock",
  },

  // ── Cook Gear ────────────────────────────────────────────────────────────
  {
    name: "Fieldkettle Folding Stove",
    description:
      "A folding canister stove the size of a lighter. Boils a liter in 3:20, simmers without cursing, and disappears into your mug when it's time to move.",
    price: 7_900,
    category: "Cook Gear",
    tags: ["ultralight", "budget"],
    imageUrl: img("photo-1444012104069-996724bf4a0a"),
    availability: "In stock",
  },
  {
    name: "Ironwood Skillet 10\"",
    description:
      "Pre-seasoned cast iron that's equally at home on the camp stove and in your kitchen. Cornbread at camp, trout on the river, and a pan that outlives the rest of your kit.",
    price: 6_400,
    category: "Cook Gear",
    tags: ["durable", "gift-worthy"],
    imageUrl: img("photo-1512058564366-18510be2db19"),
    availability: "In stock",
  },
  {
    name: "Pinecone Pour-Over Kit",
    description:
      "A ceramic dripper, a collapsible cone, and a steel filter that lives in the stuff sack. Slower mornings, better mornings — the first thing packed and the first thing out.",
    price: 4_900,
    category: "Cook Gear",
    tags: ["gift-worthy", "budget"],
    imageUrl: img("photo-1470337458703-46ad1756a187"),
    availability: "In stock",
  },
  {
    name: "Cache Bear-Proof Canister",
    description:
      "615 cubic inches of clear polycarbonate, approved everywhere canisters are required. Not glamorous. Mandatory. Fits four days of food if you pack like you mean it.",
    price: 8_400,
    category: "Cook Gear",
    tags: ["durable"],
    imageUrl: img("photo-1504754524776-8f4f37790ca0"),
    availability: "In stock",
  },
  {
    name: "Emberlite Titanium Pot 1.1L",
    description:
      "5.1 ounces of titanium with graduations etched inside and a lid that doubles as a plate. Boils, bakes, and swallows your stove, fuel, and lighter on the way down the trail.",
    price: 8_900,
    category: "Cook Gear",
    tags: ["ultralight"],
    imageUrl: img("photo-1496733570428-49657ca2f9cf"),
    availability: "Low stock — 4 left",
  },
  {
    name: "Hearthstone Enamel Cookset",
    description:
      "A speckled four-piece enamel set for the camp kitchen table. Pops into the picnic basket, shrugs off the camp sink, and makes freeze-dried dinners feel vaguely civilized.",
    price: 12_900,
    category: "Cook Gear",
    tags: ["gift-worthy", "beginner-friendly"],
    imageUrl: img("photo-1524484485831-a92ffc0de03f"),
    availability: "In stock",
  },
  {
    name: "Trailshot Water Filter",
    description:
      "A straw-style filter with a squeeze bag and exactly one moving part. Drink straight from the source and retire the pump. Rated for a thousand liters of creek, river, and questionable lake.",
    price: 3_900,
    category: "Cook Gear",
    tags: ["ultralight", "budget"],
    imageUrl: img("photo-1502943693086-33b5b1cfdf2f"),
    availability: "In stock",
  },
];

async function main() {
  const url = `file:${path.join(process.cwd(), "db", "fieldward.db")}`;
  const adapter = new PrismaBetterSqlite3({ url });
  const prisma = new PrismaClient({ adapter });

  try {
    const existing = await prisma.gearItem.count();
    if (existing > 0 && process.env.FORCE_SEED !== "1") {
      console.log(`Gear library already has ${existing} items — skipping seed. (FORCE_SEED=1 to reseed.)`);
      return;
    }

    if (existing > 0) {
      await prisma.boardItem.deleteMany();
      await prisma.tripBrief.deleteMany();
      await prisma.activityEvent.deleteMany();
      await prisma.gearItem.deleteMany();
      console.log("FORCE_SEED: cleared gear library, board, briefs, and activity log.");
    }

    // Insert in a fixed order so the tray's default sort is stable.
    for (const item of GEAR) {
      await prisma.gearItem.create({
        data: {
          name: item.name,
          description: item.description,
          price: item.price,
          category: item.category,
          tags: JSON.stringify(item.tags),
          imageUrl: item.imageUrl,
          availability: item.availability,
        },
      });
    }

    const byCategory = GEAR.reduce<Record<string, number>>((acc, item) => {
      acc[item.category] = (acc[item.category] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`Seeded ${GEAR.length} gear items:`);
    for (const [category, count] of Object.entries(byCategory)) {
      console.log(`  ${category}: ${count}`);
    }
    const constrained = GEAR.filter((g) => g.availability !== "In stock").map((g) => `${g.name} (${g.availability})`);
    console.log(`Availability-constrained: ${constrained.join(", ")}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
