import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col items-center px-4 py-24 text-center">
      <p className="eyebrow text-rust">Wrong turn</p>
      <h1 className="mt-3 font-serif text-4xl tracking-tight">That trail doesn&apos;t exist.</h1>
      <p className="mt-4 max-w-md leading-relaxed text-ink-soft">
        The page you were after isn&apos;t on our map. Head back to the board — or ask your
        agent to search the gear library for what you need.
      </p>
      <Link
        href="/"
        className="mt-8 rounded-md border border-line-strong px-5 py-2.5 text-sm text-ink transition-colors hover:border-ink hover:bg-ink hover:text-paper"
      >
        Back to the board
      </Link>
    </div>
  );
}
