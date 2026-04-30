"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { filingCategoryLabel, filingCategoryColor, formatDate, formatFilingDescription } from "@/lib/utils";

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

const CATEGORIES = [
  "all",
  "accounts",
  "confirmation_statement",
  "officers",
  "incorporation",
  "address",
  "mortgage",
  "insolvency",
  "persons-with-significant-control",
];

const MAX_EVENTS = 200;

export default function FeedClient() {
  const [events, setEvents] = useState<FilingEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState("all");
  const [connected, setConnected] = useState(false);
  const [total, setTotal] = useState(0);
  const bufferRef = useRef<FilingEvent[]>([]);
  const esRef = useRef<EventSource | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const es = new EventSource("/api/events");
    esRef.current = es;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      const ev: FilingEvent = JSON.parse(e.data);
      // Deduplicate: skip if this transactionId is already in the buffer
      if (bufferRef.current.some((b) => b.transactionId === ev.transactionId)) return;
      bufferRef.current = [ev, ...bufferRef.current].slice(0, MAX_EVENTS);
      setTotal((t) => t + 1);
      if (!paused) {
        setEvents([...bufferRef.current]);
        setNewIds((prev) => {
          const next = new Set(prev);
          next.add(ev.transactionId);
          setTimeout(() => setNewIds((p) => { const n = new Set(p); n.delete(ev.transactionId); return n; }), 400);
          return next;
        });
      }
    };
    return () => { es.close(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!paused) setEvents([...bufferRef.current]);
  }, [paused]);

  const visible = filter === "all" ? events : events.filter((e) => e.category === filter);

  return (
    <div className="space-y-4">
      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Category filters */}
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={`rounded-md border px-2.5 py-1 text-xs font-mono font-medium transition-all ${
                filter === cat
                  ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--bg-base)]"
                  : "border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
              }`}
            >
              {cat === "all" ? "ALL" : filingCategoryLabel(cat).toUpperCase()}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          {total > 0 && (
            <span className="font-mono text-xs text-[var(--text-muted)]">
              {total.toLocaleString("en-GB")} received
            </span>
          )}
          <button
            onClick={() => setPaused((p) => !p)}
            className={`rounded-md border px-3 py-1 text-xs font-mono font-medium transition-all ${
              paused
                ? "border-amber-700 bg-amber-950 text-amber-400"
                : "border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
            }`}
          >
            {paused ? "▶ RESUME" : "⏸ PAUSE"}
          </button>

          <span className="flex items-center gap-2 text-xs font-mono">
            {connected ? (
              <>
                <span className="live-dot" />
                <span className="text-[var(--live)]">LIVE</span>
              </>
            ) : (
              <span className="text-[var(--text-muted)]">CONNECTING…</span>
            )}
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        {visible.length === 0 ? (
          <div className="py-20 text-center font-mono text-sm text-[var(--text-muted)]">
            {connected ? "WAITING FOR FILINGS…" : "CONNECTING TO STREAM…"}
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Category</th>
                <th className="hidden md:table-cell">Description</th>
                <th className="text-right">Filed</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((ev) => (
                <tr
                  key={ev.transactionId}
                  className={newIds.has(ev.transactionId) ? "animate-slide-in" : ""}
                >
                  <td>
                    <Link
                      href={`/c/${ev.companyNumber}`}
                      className="font-medium text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors"
                    >
                      {ev.companyName}
                    </Link>
                    <div className="font-mono text-xs text-[var(--text-muted)] mt-0.5">
                      {ev.companyNumber}
                    </div>
                  </td>
                  <td>
                    <span className={`badge border ${filingCategoryColor(ev.category)}`}>
                      {filingCategoryLabel(ev.category)}
                    </span>
                  </td>
                  <td className="hidden max-w-xs truncate md:table-cell text-xs text-[var(--text-secondary)]">
                    {formatFilingDescription(ev.type, ev.description)}
                  </td>
                  <td className="text-right font-mono text-xs text-[var(--text-muted)]">
                    {formatDate(ev.filingDate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-center font-mono text-xs text-[var(--text-muted)]">
        Showing up to {MAX_EVENTS} most recent · {paused ? "paused" : "live"}
      </p>
    </div>
  );
}
