import Link from "next/link";
import SearchBox from "@/components/ui/SearchBox";

export default function NavBar() {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border-subtle)] bg-[var(--bg-base)]/90 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
        {/* Logo */}
        <Link href="/" className="shrink-0 flex items-center gap-2 group">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--live)] opacity-50" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--live)]" />
          </span>
          <span className="font-mono text-sm font-bold tracking-tight text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">
            companieshouse<span className="text-[var(--accent)]">.</span>watch
          </span>
        </Link>

        {/* Search */}
        <div className="flex-1">
          <SearchBox />
        </div>

        {/* Nav links */}
        <nav className="hidden items-center gap-1 text-sm sm:flex">
          <Link
            href="/feed"
            className="rounded px-3 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-colors"
          >
            Live feed
          </Link>
          <Link
            href="/about"
            className="rounded px-3 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-colors"
          >
            About
          </Link>
        </nav>
      </div>
    </header>
  );
}
