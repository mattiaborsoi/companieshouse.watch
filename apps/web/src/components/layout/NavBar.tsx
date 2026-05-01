import Link from "next/link";
import SearchBox from "@/components/ui/SearchBox";
import { getStatusBar, getAnomalies } from "@/lib/db";
import { timeAgo } from "@/lib/utils";

async function StatusBar() {
  try {
    const s = await getStatusBar();
    const ago = s.lastEventAt ? timeAgo(s.lastEventAt) : null;
    return (
      <div className="border-b border-[var(--border)] bg-[var(--bg-surface)] px-4 py-1">
        <div className="mx-auto flex max-w-6xl items-center gap-6 overflow-x-auto">
          {/* Live indicator */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--live)] opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--live)]" />
            </span>
            <span className="font-mono text-[10px] tracking-widest uppercase text-[var(--live)]">Streaming live</span>
          </div>

          <span className="text-[var(--border)] select-none">|</span>

          <span className="font-mono text-[10px] tracking-widest uppercase text-[var(--text-muted)] whitespace-nowrap">
            <span className="text-[var(--text-secondary)]">{s.filingsToday.toLocaleString("en-GB")}</span>
            {" "}filings today
          </span>

          <span className="text-[var(--border)] select-none">|</span>

          <span className="font-mono text-[10px] tracking-widest uppercase text-[var(--text-muted)] whitespace-nowrap">
            <span className="text-[var(--text-secondary)]">{s.companiesTotal.toLocaleString("en-GB")}</span>
            {" "}companies
          </span>

          {s.lastEventAt && (() => {
            const ageMs = Date.now() - new Date(s.lastEventAt).getTime();
            const ageMins = ageMs / 60_000;
            // Pin to Europe/London — server runs in UTC, but Companies House
            // is a UK register and visitors expect UK local time (BST in
            // summer, GMT in winter).
            const timeStr = new Date(s.lastEventAt).toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Europe/London",
            });
            const color = ageMins < 5 ? "text-[var(--live)]" : ageMins < 30 ? "text-[var(--text-secondary)]" : "text-amber-400";
            return (
              <>
                <span className="text-[var(--border)] select-none">|</span>
                <span className={`font-mono text-[10px] tracking-widest uppercase whitespace-nowrap ${color}`}>
                  Latest filing {timeStr}
                </span>
              </>
            );
          })()}

          <span className="ml-auto shrink-0 font-mono text-[10px] tracking-widest uppercase text-[var(--text-muted)] hidden sm:block">
            4 streams active
          </span>
        </div>
      </div>
    );
  } catch {
    return null;
  }
}

async function AnomalyNavBadge() {
  try {
    const top = await getAnomalies(1);
    if (!top.length) return null;
    const count = (await getAnomalies(100)).length;
    return (
      <span className="ml-1 inline-flex items-center justify-center rounded font-mono text-[9px] font-bold tabular-nums px-1 py-0.5 bg-red-950 text-red-300 border border-red-800">
        {count}
      </span>
    );
  } catch {
    return null;
  }
}

export default function NavBar() {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--bg-base)]/95 backdrop-blur-sm">
      <StatusBar />
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2.5">
        {/* Logo */}
        <Link href="/" className="shrink-0 group">
          <span className="font-mono text-sm font-bold tracking-tight text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">
            companieshouse<span className="text-[var(--accent)]">.</span>watch
          </span>
        </Link>

        {/* Search */}
        <div className="flex-1 max-w-xl">
          <SearchBox />
        </div>

        {/* Nav — anomalies first, it's the differentiator */}
        <nav className="hidden items-center gap-1 sm:flex">
          <Link href="/anomalies" className="nav-link flex items-center">
            Anomalies
            <AnomalyNavBadge />
          </Link>
          <Link href="/feed" className="nav-link">Feed</Link>
          <Link href="/support" className="nav-link" style={{ color: "var(--alert)" }}>Support ♥</Link>
        </nav>
      </div>
    </header>
  );
}
