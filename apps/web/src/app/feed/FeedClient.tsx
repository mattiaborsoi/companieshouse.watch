"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { filingCategoryLabel, filingCategoryColor, formatDate } from "@/lib/utils";

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
  const bufferRef = useRef<FilingEvent[]>([]);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/events");
    esRef.current = es;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      const ev: FilingEvent = JSON.parse(e.data);
      bufferRef.current = [ev, ...bufferRef.current].slice(0, MAX_EVENTS);
      if (!paused) {
        setEvents([...bufferRef.current]);
      }
    };
    return () => { es.close(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When unpausing, flush buffer
  useEffect(() => {
    if (!paused) {
      setEvents([...bufferRef.current]);
    }
  }, [paused]);

  const visible = filter === "all"
    ? events
    : events.filter((e) => e.category === filter);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                filter === cat
                  ? "border-brand-500 bg-brand-50 text-brand-700"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {cat === "all" ? "All" : filingCategoryLabel(cat)}
            </button>
          ))}
        </div>

        <button
          onClick={() => setPaused((p) => !p)}
          className={`ml-auto rounded-md border px-3 py-1.5 text-xs font-medium ${
            paused
              ? "border-orange-300 bg-orange-50 text-orange-700"
              : "border-gray-200 bg-white text-gray-600"
          }`}
        >
          {paused ? "▶ Resume" : "⏸ Pause"}
        </button>

        <span className="flex items-center gap-1.5 text-xs text-gray-500">
          <span
            className={`h-2 w-2 rounded-full ${connected ? "bg-green-500 animate-pulse" : "bg-gray-300"}`}
          />
          {connected ? "live" : "connecting…"}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border bg-white">
        {visible.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">
            {connected ? "Waiting for filings…" : "Connecting…"}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-xs text-gray-500">
                <th className="px-4 py-2 text-left">Company</th>
                <th className="px-4 py-2 text-left">Category</th>
                <th className="hidden px-4 py-2 text-left md:table-cell">Description</th>
                <th className="px-4 py-2 text-right">Filed</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {visible.map((ev) => (
                <tr key={ev.transactionId} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/c/${ev.companyNumber}`}
                      className="font-medium text-gray-900 hover:underline"
                    >
                      {ev.companyName}
                    </Link>
                    <div className="font-mono text-xs text-gray-400">{ev.companyNumber}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`badge ${filingCategoryColor(ev.category)}`}>
                      {filingCategoryLabel(ev.category)}
                    </span>
                  </td>
                  <td className="hidden max-w-xs truncate px-4 py-2.5 text-gray-500 md:table-cell">
                    {ev.description || ev.type}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-500">
                    {formatDate(ev.filingDate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-gray-400 text-center">
        Showing up to {MAX_EVENTS} most recent events
      </p>
    </div>
  );
}
