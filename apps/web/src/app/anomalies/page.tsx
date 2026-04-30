import type { Metadata } from "next";
import Link from "next/link";
import { getAnomalies } from "@/lib/db";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Anomaly detection" };
export const dynamic = "force-dynamic";

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 70 ? "text-red-300 border-red-700 bg-red-950" :
    score >= 40 ? "text-orange-300 border-orange-700 bg-orange-950" :
                  "text-yellow-300 border-yellow-700 bg-yellow-950";
  return (
    <span className={`badge border font-mono font-bold text-xs ${color}`}>
      {score}
    </span>
  );
}

export default async function AnomaliesPage() {
  const anomalies = await getAnomalies(50);

  if (!anomalies.length) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 space-y-6 text-center">
        <p className="section-label mx-auto">Anomaly detection</p>
        <h1 className="font-mono text-3xl font-bold text-[var(--text-primary)]">
          Address-cluster detection
        </h1>
        <p className="text-sm text-[var(--text-secondary)] max-w-lg mx-auto leading-relaxed">
          Automatic detection of suspicious address clusters — addresses with an unusually
          high number of recently-incorporated companies sharing the same directors.
        </p>
        <div className="panel-elevated inline-block px-8 py-5 mx-auto">
          <div className="font-mono text-xs uppercase tracking-widest text-[var(--text-muted)] mb-1">Status</div>
          <div className="font-mono text-lg font-bold text-[var(--accent)]">No clusters detected yet</div>
          <div className="font-mono text-xs text-[var(--text-muted)] mt-1">
            Detection runs every 10 minutes once data is flowing
          </div>
        </div>
        <div className="pt-4">
          <Link href="/" className="btn-ghost text-xs">← Back to live feed</Link>
        </div>
      </div>
    );
  }

  const KIND_LABEL: Record<string, string> = {
    address_cluster:    "Address cluster",
    director_velocity:  "Director velocity",
    officer_churn:      "Officer churn",
    bulk_registration:  "Bulk registration",
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-8">

      <div className="space-y-2">
        <p className="section-label">Anomaly detection</p>
        <h1 className="font-mono text-3xl font-bold text-[var(--text-primary)]">
          {anomalies.length} active anomalies
        </h1>
        <p className="text-sm text-[var(--text-secondary)] max-w-2xl leading-relaxed">
          Automatically detected patterns: address clusters, director velocity, officer churn,
          and bulk registration events. Scored 0–100 and updated every 10 minutes.
          High scores indicate an unusual pattern — not wrongdoing.
        </p>
      </div>

      <div className="panel overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Score</th>
              <th>Type</th>
              <th>Subject</th>
              <th className="text-right hidden sm:table-cell">Companies</th>
              <th className="text-right hidden lg:table-cell">Last detected</th>
              <th className="text-right">AI</th>
            </tr>
          </thead>
          <tbody>
            {anomalies.map((a) => {
              const f = a.features;
              const subject = a.kind === "director_velocity"
                ? (f.officer_name ?? "Unknown officer")
                : (
                    [f.address_line_1, f.locality, f.postcode].filter(Boolean).join(", ")
                    || a.detectionKey.slice(0, 16) + "…"
                  );
              return (
                <tr key={a.id}>
                  <td><ScoreBadge score={a.score} /></td>
                  <td>
                    <span className="font-mono text-[10px] text-[var(--text-muted)]">
                      {KIND_LABEL[a.kind] ?? a.kind}
                    </span>
                  </td>
                  <td>
                    <Link href={`/anomalies/${a.id}`}
                      className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors">
                      {subject}
                    </Link>
                    {f.formation_agent && (
                      <span className="ml-2 badge border bg-zinc-900 text-zinc-400 border-zinc-600 font-mono text-[9px]">
                        Reg. office service
                      </span>
                    )}
                  </td>
                  <td className="text-right font-mono text-sm text-[var(--accent)] hidden sm:table-cell">
                    {f.company_count}
                  </td>
                  <td className="text-right font-mono text-xs text-[var(--text-muted)] hidden lg:table-cell">
                    {formatDate(a.lastDetectedAt)}
                  </td>
                  <td className="text-right">
                    {a.aiSummaryOutput
                      ? <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--accent)]">✓</span>
                      : <span className="font-mono text-[10px] text-[var(--text-muted)]">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="font-mono text-[10px] text-[var(--text-muted)] leading-relaxed">
        Detection runs every 10 minutes. AI explanations are generated on demand.
        Data from Companies House under the OGL v3.0.
      </p>
      <p className="font-mono text-[10px] text-[var(--text-muted)] leading-relaxed border-t border-[var(--border-subtle)] pt-4">
        These pages describe statistical patterns in public Companies House data.
        Many patterns have ordinary commercial explanations — formation agents, group structures,
        or registered-office services. <strong className="text-[var(--text-secondary)]">Patterns are not allegations.</strong>{" "}
        See our <Link href="/legal" className="text-[var(--accent)] hover:underline underline-offset-2">legal &amp; takedown</Link> page.
      </p>
    </div>
  );
}
