import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Bot } from "lucide-react";

import { db } from "@/lib/db";
import { toGearDTO } from "@/lib/gear";
import { GearDetailActions } from "@/components/gear-detail-actions";
import { GearViewLogger } from "@/components/gear-view-logger";

export const dynamic = "force-dynamic";

async function loadGear(id: string) {
  const item = await db.gearItem.findUnique({ where: { id } });
  return item === null ? null : toGearDTO(item);
}

async function loadRelated(category: string, excludeId: string) {
  const related = await db.gearItem.findMany({
    where: { category, id: { not: excludeId }, source: "catalog" },
    take: 4,
  });
  return related.map(toGearDTO).sort((a, b) => a.name.localeCompare(b.name));
}

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const item = await loadGear(id);
  if (item === null) return { title: "Not found" };
  return { title: item.name, description: item.description };
}

export default async function GearDetailPage({ params }: PageProps) {
  const { id } = await params;
  const item = await loadGear(id);
  if (item === null) notFound();

  const related = await loadRelated(item.category, item.id);

  const availabilityTone = item.available ? "text-moss-deep" : "text-rust";

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16">
      {/* Quietly record the view in the shared activity log. */}
      <GearViewLogger gearItemId={item.id} name={item.name} />

      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="py-5 text-sm text-ink-faint">
        <ol className="flex flex-wrap items-center gap-2">
          <li>
            <Link href="/" className="transition-colors hover:text-ink">
              The board
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>{item.category}</li>
          <li aria-hidden="true">/</li>
          <li className="text-ink-soft">{item.name}</li>
        </ol>
      </nav>

      <div className="grid gap-10 md:grid-cols-[1.2fr_1fr] md:gap-12">
        {/* Photo */}
        <div className="relative aspect-[4/3] overflow-hidden rounded-md border border-line bg-sand">
          <Image
            src={item.imageUrl}
            alt={item.name}
            fill
            priority
            sizes="(min-width: 768px) 55vw, 100vw"
            className="object-cover"
          />
        </div>

        {/* Details — sticky on desktop */}
        <div className="md:sticky md:top-32 md:self-start">
          <p className="eyebrow text-rust">{item.category}</p>
          <h1 className="mt-2 font-serif text-3xl leading-tight tracking-tight md:text-4xl">
            {item.name}
          </h1>

          <div className="mt-3 flex items-baseline gap-3">
            <p className="text-xl font-medium tabular-nums">{item.priceDisplay}</p>
            <p className={`text-sm ${availabilityTone}`}>{item.availability}</p>
          </div>

          <p className="mt-5 leading-relaxed text-ink-soft">{item.description}</p>

          <dl className="mt-6 divide-y divide-line border-y border-line text-sm">
            <div className="flex justify-between gap-4 py-2.5">
              <dt className="text-ink-faint">Category</dt>
              <dd className="text-ink">{item.category}</dd>
            </div>
            <div className="flex justify-between gap-4 py-2.5">
              <dt className="text-ink-faint">Tags</dt>
              <dd className="text-right">{item.tags.length > 0 ? item.tags.join(", ") : "—"}</dd>
            </div>
            <div className="flex justify-between gap-4 py-2.5">
              <dt className="text-ink-faint">In the plan</dt>
              <dd className="text-ink">reference price for the budget roll-up</dd>
            </div>
          </dl>

          <div className="mt-6">
            <GearDetailActions gear={item} />
          </div>

          <p className="mt-4 flex items-start gap-2 rounded-md border border-line bg-sand/60 px-3 py-2.5 text-xs leading-relaxed text-ink-soft">
            <Bot aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-moss" strokeWidth={1.75} />
            Your agent can place this too — with its reasoning attached. Locking the plan
            stays a button only you can press.
          </p>
        </div>
      </div>

      {related.length > 0 && (
        <section aria-label={`More ${item.category.toLowerCase()}`} className="mt-16">
          <div className="flex items-baseline justify-between border-b border-line pb-3">
            <h2 className="font-serif text-2xl tracking-tight">More {item.category.toLowerCase()}</h2>
            <Link href="/" className="text-sm text-rust underline-offset-2 hover:underline">
              Back to the board
            </Link>
          </div>
          <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {related.map((entry) => (
              <li key={entry.id}>
                <Link
                  href={`/gear/${entry.id}`}
                  className="flex items-center gap-3 rounded-md border border-line bg-paper-raised px-3 py-2.5 transition-colors hover:border-ink"
                >
                  <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-sm border border-line bg-sand">
                    <Image
                      src={entry.imageUrl}
                      alt=""
                      fill
                      sizes="44px"
                      className="object-cover"
                      draggable={false}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-serif text-sm tracking-tight text-ink">
                      {entry.name}
                    </span>
                    <span className="block text-xs tabular-nums text-ink-faint">
                      {entry.priceDisplay}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
