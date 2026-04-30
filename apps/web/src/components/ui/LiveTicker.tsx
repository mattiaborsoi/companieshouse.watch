"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { filingCategoryLabel, filingCategoryColor } from "@/lib/utils";

interface FilingEvent {
  transactionId: string;
  companyNumber: string;
  companyName: string;
  category: string;
  type: string;
  description: string;
  filingDate: string | null;
  ingestedAt: string;
}

const MAX = 60;

export default function LiveTicker({ initialEvents = [] }: { initialEvents?: FilingEvent[] }) {
  const [events, setEvents] = useState<FilingEvent[]>(initialEvents);
  const [connected, setConnected] = useState(false);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const seenRef = useRef<Set<string>>(new Set(initialEvents.map((e) => e.transactionId)));

  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      const ev: FilingEvent = JSON.parse(e.data);
      if (seenRef.current.has(ev.transactionId)) return;
      seenRef.current.add(ev.transactionId);
      setEvents((prev) => [ev, ...prev].slice(0, MAX));
      setNewIds((prev) => new Set(prev).add(ev.transactionId));
      setTimeout(() => setNewIds((prev) => {
        const next = new Set(prev); next.delete(ev.transactionId); return next;
      }), 600);
    };
    return () => es.close();
  }, []);

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden"
         style={{ boxShadow: "var(--panel-shadow)" }}>

      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-2">
        <span className="section-label">Live stream</span>
        <span className="flex items-center gap-2">
          {connected ? (
            <>
              <span className="live-dot" />
              <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--live)]">Live</span>
            </>
          ) : (
            <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
              {events.length > 0 ? "Reconnecting…" : "Connecting…"}
            </span>
          )}
        </span>
      </div>

      {/* Events */}
      {events.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <div className="font-mono text-xs text-[var(--text-muted)]">Waiting for filings…</div>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)] max-h-[540px] overflow-y-auto">
          {events.map((ev) => (
            <li
              key={ev.transactionId}
              className={`flex items-start gap-3 px-3 py-2.5 hover:bg-[var(--bg-elevated)] transition-colors cursor-default ${
                newIds.has(ev.transactionId) ? "animate-slide-in" : ""
              }`}
            >
              <span className={`badge mt-0.5 shrink-0 border ${filingCategoryColor(ev.category)}`}
                    style={{ fontSize: "9px" }}>
                {filingCategoryLabel(ev.category)}
              </span>
              <div className="min-w-0 flex-1">
                <Link href={`/c/${ev.companyNumber}`}
                  className="text-xs font-medium text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors leading-tight block truncate">
                  {ev.companyName}
                </Link>
                {ev.description && (
                  <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--text-muted)]">
                    {ev.description}
                  </p>
                )}
              </div>
              <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)] tracking-wide">
                {ev.companyNumber}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
