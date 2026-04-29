import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Anomaly detection" };

export default function AnomaliesPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 space-y-6 text-center">
      <p className="section-label mx-auto">Anomaly detection</p>
      <h1 className="font-mono text-3xl font-bold text-[var(--text-primary)]">
        Address-cluster detection
      </h1>
      <p className="text-sm text-[var(--text-secondary)] max-w-lg mx-auto leading-relaxed">
        Automatic detection of suspicious address clusters — addresses with an unusually
        high number of recently-incorporated companies sharing the same directors.
        AI-generated plain-English explanations for each cluster.
      </p>

      <div className="panel-elevated inline-block px-8 py-5 mx-auto">
        <div className="font-mono text-xs uppercase tracking-widest text-[var(--text-muted)] mb-1">Status</div>
        <div className="font-mono text-lg font-bold text-[var(--alert)]">Building now</div>
        <div className="font-mono text-xs text-[var(--text-muted)] mt-1">Phase 3 of the project roadmap</div>
      </div>

      <div className="pt-4">
        <Link href="/" className="btn-ghost text-xs">← Back to live feed</Link>
      </div>
    </div>
  );
}
