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

  useEffect(() => {
    function connect() {
      const es = new EventSource("/api/events");
      esRef.current = es;

      es.onopen = () => setConnected(true);
      es.onerror = () => setConnected(false);

      es.onmessage = (e) => {
        const event: FilingEvent = JSON.parse(e.data);
        setEvents((prev) => {
          const next = [event, ...prev];
          return next.slice(0, MAX_EVENTS);
        });
      };
    }

    connect();
    return () => {
      esRef.current?.close();
    };
  }, []);

  return (
    <div className="rounded-lg border bg-white">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-900">Live filings</h2>
        <span className="flex items-center gap-1.5 text-xs text-gray-500">
          <span
            className={`h-2 w-2 rounded-full ${connected ? "bg-green-500 animate-pulse" : "bg-gray-300"}`}
          />
          {connected ? "live" : "connecting…"}
        </span>
      </div>

      {events.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-gray-400">
          Waiting for filings…
        </div>
      ) : (
        <ul className="divide-y text-sm">
          {events.map((ev) => (
            <li key={ev.transactionId} className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50">
              <span
                className={`badge mt-0.5 shrink-0 ${filingCategoryColor(ev.category)}`}
              >
                {filingCategoryLabel(ev.category)}
              </span>
              <div className="min-w-0 flex-1">
                <Link
                  href={`/c/${ev.companyNumber}`}
                  className="font-medium text-gray-900 hover:underline"
                >
                  {ev.companyName}
                </Link>
                {ev.description && (
                  <p className="mt-0.5 truncate text-gray-500">{ev.description}</p>
                )}
              </div>
              <span className="shrink-0 text-xs text-gray-400">
                {ev.companyNumber}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
