import Link from "next/link";
import { Tent } from "lucide-react";

import { categoryMeta, SITE } from "@/lib/theme";

export function SiteFooter() {
  return (
    <footer className="mt-auto bg-pine text-paper/85 print-hidden">
      <div className="mx-auto grid max-w-[1600px] gap-10 px-4 py-12 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <p className="flex items-center gap-2">
            <Tent aria-hidden="true" className="h-5 w-5 text-paper" strokeWidth={1.75} />
            <span className="font-serif text-2xl tracking-tight text-paper">Fieldward</span>
          </p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-paper/70">
            {SITE.description}
          </p>
        </div>

        <nav aria-label="Gear categories">
          <p className="eyebrow text-paper/60">Gear library</p>
          <ul className="mt-3 space-y-2 text-sm">
            {categoryMeta.map((category) => (
              <li key={category.name}>
                <Link href="/" className="transition-colors hover:text-paper">
                  {category.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div>
          <p className="eyebrow text-paper/60">The fine print</p>
          <ul className="mt-3 space-y-2 text-sm text-paper/70">
            <li>A planning demo — nothing here is for sale.</li>
            <li>Boards live in your browser session; nothing tracks you.</li>
            <li>
              Built for The WebMCP Challenge. Open-sourced under the{" "}
              <span className="text-paper/85">MIT license</span>.
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-paper/15">
        <p className="mx-auto max-w-[1600px] px-4 py-4 text-xs text-paper/55">
          © {new Date().getFullYear()} Fieldward · Agents build the plan with you. You
          decide when it's done.
        </p>
      </div>
    </footer>
  );
}
