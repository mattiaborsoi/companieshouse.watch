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

const MAX_EVENTS = 50;

export default function LiveTicker() {
  const [events, setEvents] = useState<FilingEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const es = new EventSource("/api/events");
    esRef.current = es;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      const event: FilingEvent = JSON.parse(e.data);
      setEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS));
      setNewIds((prev) => new Set(prev).add(event.transactionId));
      setTimeout(() => {
        setNewIds((prev) => {
          const next = new Set(prev);
          next.delete(event.transactionId);
          return next;
        });
      }, 600);
    };
    return () => { es.close(); };
  }, []);

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Live stream
        </h2>
        <span className="flex items-center gap-2 text-xs">
          {connected ? (
            <>
              <span className="live-dot" />
              <span className="text-[var(--live)] font-mono">LIVE</span>
            </>
          ) : (
            <span className="text-[var(--text-muted)] font-mono">CONNECTING…</span>
          )}
        </span>
      </div>

      {events.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">
          {connected ? "Waiting for filings…" : "Connecting to stream…"}
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)] max-h-[480px] overflow-y-auto">
          {events.map((ev) => (
            <li
              key={ev.transactionId}
              className={`flex items-start gap-3 px-4 py-3 hover:bg-[var(--bg-elevated)] transition-colors ${
                newIds.has(ev.transactionId) ? "animate-slide-in bg-[var(--bg-elevated)]" : ""
              }`}
            >
              <span className={`badge mt-0.5 shrink-0 border ${filingCategoryColor(ev.category)}`}>
                {filingCategoryLabel(ev.category)}
              </span>
              <div className="min-w-0 flex-1">
                <Link
                  href={`/c/${ev.companyNumber}`}
                  className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors"
                >
                  {ev.companyName}
                </Link>
                {ev.description && (
                  <p className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">{ev.description}</p>
                )}
              </div>
              <span className="shrink-0 font-mono text-xs text-[var(--text-muted)]">
                {ev.companyNumber}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
