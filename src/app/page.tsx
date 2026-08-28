import { db } from "@/lib/db";
import { toGearDTO } from "@/lib/gear";
import { BoardWorkspace } from "@/components/board/board-workspace";
import { TripBriefPanel } from "@/components/trip-brief-panel";
import { CATEGORIES, type GearItemDTO } from "@/lib/types";
import { SITE } from "@/lib/theme";

export const dynamic = "force-dynamic";

async function loadGear(): Promise<GearItemDTO[]> {
  const gear = await db.gearItem.findMany();
  const dtos = gear.map(toGearDTO);
  // Stable default order: category order, then name.
  const categoryOrder = new Map<string, number>(CATEGORIES.map((name, index) => [name, index]));
  return dtos.sort((a, b) => {
    const categoryDelta =
      (categoryOrder.get(a.category) ?? 99) - (categoryOrder.get(b.category) ?? 99);
    if (categoryDelta !== 0) return categoryDelta;
    return a.name.localeCompare(b.name);
  });
}

export default async function HomePage() {
  const gear = await loadGear();

  return (
    <div>
      {/* Intro band — slim, text-led; leads with the board, not the gear. */}
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-[1600px] gap-8 px-4 py-12 md:grid-cols-[1.5fr_1fr] md:py-16">
          <div>
            <p className="eyebrow text-rust">A planning board you share with your agent</p>
            <h1 className="mt-3 max-w-xl font-serif text-4xl leading-tight tracking-tight text-ink md:text-5xl">
              {SITE.tagline}
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-ink-soft">
              Fieldward is one live board where you and your AI agent plan a trip together:
              gear cards, day blocks, and a budget line — everything movable, everything
              attributed. Your agent searches the gear library, places its picks with the
              reasoning written beside them, and tidies the board while you drag things
              around. When the plan is right, you lock it. That part stays yours — no tool
              can do it for you.
            </p>
          </div>

          {/* Index card — the board's table of contents. */}
          <aside
            aria-label="Gear library index"
            className="hidden self-start rounded-md border border-line bg-paper-raised p-5 md:block"
          >
            <p className="eyebrow text-ink-faint">The gear library</p>
            <ul className="mt-3 divide-y divide-line text-sm">
              {CATEGORIES.map((category) => {
                const count = gear.filter((item) => item.category === category).length;
                return (
                  <li key={category} className="flex items-center justify-between py-2.5">
                    <span className="text-ink">{category}</span>
                    <span className="tabular-nums text-ink-faint">{count} items</span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-ink-faint">
              Drag anything onto the board — or ask your agent to build the kit while you
              sketch the days.
            </p>
          </aside>
        </div>
      </section>

      <TripBriefPanel />

      <div className="pt-6">
        <BoardWorkspace gear={gear} />
      </div>
    </div>
  );
}
