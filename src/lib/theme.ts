/**
 * Fieldward design tokens and gear-library metadata.
 *
 * The palette and font stacks mirror the `@theme` block in
 * src/app/globals.css (Tailwind v4 CSS-first config). Keep both in sync —
 * this file is for places where TS needs the raw values (charts, inline
 * styles, metadata) rather than a Tailwind utility.
 */

export const palette = {
  paper: "#f5f1e8",
  paperRaised: "#fcfaf3",
  sand: "#ebe4d2",
  ink: "#29261f",
  inkSoft: "#5b564b",
  inkFaint: "#8a8474",
  line: "#ddd5c1",
  lineStrong: "#c8bea5",
  rust: "#b4552b",
  rustDeep: "#8f421f",
  moss: "#5a6549",
  mossDeep: "#454f37",
  pine: "#30362a",
  clay: "#a23b2a",
} as const;

export const fonts = {
  /** CSS variable set by next/font in app/layout.tsx. */
  serif: "var(--font-fraunces), Georgia, serif",
  sans: "var(--font-inter), system-ui, sans-serif",
} as const;

/** Category metadata for the gear tray and readiness UI. */
export const categoryMeta: { name: string; blurb: string }[] = [
  { name: "Backpacks", blurb: "Packs for the mile count you actually do." },
  { name: "Footwear", blurb: "Broken in on the first day, not the fiftieth." },
  { name: "Shelter", blurb: "Tents, bags, and tarps that earn their carry weight." },
  { name: "Cook Gear", blurb: "The camp kitchen, minus the gimmicks." },
];

/** The full tag vocabulary used across the gear library. */
export const tagVocabulary = [
  "waterproof",
  "ultralight",
  "budget",
  "winter-rated",
  "gift-worthy",
  "durable",
  "beginner-friendly",
  "travel",
] as const;

export const SITE = {
  name: "Fieldward",
  tagline: "One board for the long way around.",
  description:
    "A live planning board where a human and their AI agent build one trip together via WebMCP — gear, days, and budget as movable cards. Locking the plan stays yours.",
} as const;
