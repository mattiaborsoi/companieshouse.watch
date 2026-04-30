import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAnomaly, getCompaniesAtAddress, getSharedDirectors, chSlugFromLink } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import ExplainButton from "@/components/ui/ExplainButton";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
  const { id } = await params;
  const anomaly = await getAnomaly(id);
  if (!anomaly) return { title: "Not found" };
  if (anomaly.kind === "director_velocity") {
    return { title: `Director: ${anomaly.features.officer_name ?? id}` };
  }
  const f = anomaly.features;
  const addr = [f.address_line_1, f.locality, f.postcode].filter(Boolean).join(", ");
  return { title: `Cluster: ${addr || id}` };
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "active"    ? "text-green-300 border-green-700 bg-green-950" :
    status === "dissolved" ? "text-zinc-400 border-zinc-600 bg-zinc-900" :
                             "text-orange-300 border-orange-700 bg-orange-950";
  return <span className={`badge border text-[9px] ${color}`}>{status}</span>;
}

function ScoreBar({ score }: { score: number }) {
  const color =
    score >= 70 ? "bg-red-500" :
    score >= 40 ? "bg-orange-500" :
                  "bg-yellow-500";
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="font-mono text-sm font-bold text-[var(--text-primary)] tabular-nums w-8 text-right">
        {score}
      </span>
    </div>
  );
}

// ─── Address cluster detail ────────────────────────────────

async function AddressClusterDetail({ anomaly }: { anomaly: Awaited<ReturnType<typeof getAnomaly>> }) {
  if (!anomaly) return null;
  const f = anomaly.features;
  const addressParts = [f.address_line_1, f.locality, f.postcode].filter(Boolean);
  const address = addressParts.join(", ") || "Unknown address";

  const [companies, sharedDirs] = await Promise.all([
    getCompaniesAtAddress(anomaly.detectionKey),
    getSharedDirectors(anomaly.detectionKey),
  ]);

  return (
    <>
      <div className="space-y-3">
        <p className="section-label">Address cluster</p>
        <h1 className="font-mono text-2xl font-bold text-[var(--text-primary)] leading-snug">
          {address}
        </h1>
        <div className="flex flex-wrap gap-6 font-mono text-xs text-[var(--text-muted)]">
          <span>First detected: <span className="text-[var(--text-secondary)]">{formatDate(anomaly.firstDetectedAt)}</span></span>
          <span>Last confirmed: <span className="text-[var(--text-secondary)]">{formatDate(anomaly.lastDetectedAt)}</span></span>
        </div>
      </div>

      <div className="panel p-5 space-y-4">
        <div className="flex items-center justify-between">
          <span className="section-label">Anomaly score</span>
          <span className="font-mono text-[10px] text-[var(--text-muted)]">0 – 100</span>
        </div>
        <ScoreBar score={anomaly.score} />
        <div className="grid grid-cols-3 gap-4 pt-2 border-t border-[var(--border-subtle)]">
          <div>
            <div className="font-mono text-2xl font-bold text-[var(--accent)] tabular-nums">{f.company_count}</div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Companies</div>
          </div>
          <div>
            <div className="font-mono text-2xl font-bold text-[var(--text-primary)] tabular-nums">{f.recently_incorporated ?? 0}</div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Last 90 days</div>
          </div>
          <div>
            <div className="font-mono text-2xl font-bold text-[var(--text-primary)] tabular-nums">{f.shared_directors ?? 0}</div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Shared directors</div>
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="section-label">AI explanation</h2>
        {anomaly.aiSummaryOutput ? (
          <div className="panel p-4 space-y-2">
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{anomaly.aiSummaryOutput}</p>
            <p className="font-mono text-[10px] text-[var(--text-muted)]">
              AI-generated · Claude Haiku
              {anomaly.aiSummaryGeneratedAt ? ` · ${formatDate(anomaly.aiSummaryGeneratedAt)}` : ""}.
              Factual summary only — no legal conclusions.
            </p>
          </div>
        ) : (
          <ExplainButton anomalyId={anomaly.id} />
        )}
      </section>

      {sharedDirs.length > 0 && (
        <section className="space-y-3">
          <h2 className="section-label">Directors at multiple companies here</h2>
          <div className="panel overflow-hidden">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="text-right">Companies here</th>
                  <th className="hidden sm:table-cell">Nationality</th>
                </tr>
              </thead>
              <tbody>
                {sharedDirs.map((d) => (
                  <tr key={d.officerId}>
                    <td>
                      <Link href={`/officer/${d.officerId}`}
                        className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors">
                        {d.nameFull}
                      </Link>
                    </td>
                    <td className="text-right font-mono text-sm text-[var(--accent)]">{d.companyCount}</td>
                    <td className="hidden sm:table-cell font-mono text-xs text-[var(--text-muted)]">{d.nationality ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="section-label">
          {companies.length} registered {companies.length === 1 ? "company" : "companies"}
        </h2>
        <div className="panel overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Status</th>
                <th className="text-right hidden sm:table-cell">Incorporated</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.companyNumber}>
                  <td>
                    <Link href={`/c/${c.companyNumber}`}
                      className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors">
                      {c.name}
                    </Link>
                    <div className="font-mono text-[10px] text-[var(--text-muted)] mt-0.5">{c.companyNumber}</div>
                  </td>
                  <td><StatusBadge status={c.status} /></td>
                  <td className="text-right font-mono text-xs text-[var(--text-muted)] hidden sm:table-cell">
                    {c.incorporatedOn ? formatDate(c.incorporatedOn) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

// ─── Director velocity detail ──────────────────────────────

function DirectorVelocityDetail({ anomaly }: { anomaly: Awaited<ReturnType<typeof getAnomaly>> }) {
  if (!anomaly) return null;
  const f = anomaly.features;

  return (
    <>
      <div className="space-y-3">
        <p className="section-label">Director velocity</p>
        <h1 className="font-mono text-2xl font-bold text-[var(--text-primary)] leading-snug">
          {f.officer_name ?? "Unknown officer"}
        </h1>
        <div className="flex flex-wrap gap-6 font-mono text-xs text-[var(--text-muted)]">
          {f.nationality && <span>{f.nationality}</span>}
          <span>First detected: <span className="text-[var(--text-secondary)]">{formatDate(anomaly.firstDetectedAt)}</span></span>
          <span>Last confirmed: <span className="text-[var(--text-secondary)]">{formatDate(anomaly.lastDetectedAt)}</span></span>
        </div>
      </div>

      <div className="panel p-5 space-y-4">
        <div className="flex items-center justify-between">
          <span className="section-label">Anomaly score</span>
          <span className="font-mono text-[10px] text-[var(--text-muted)]">0 – 100</span>
        </div>
        <ScoreBar score={anomaly.score} />
        <div className="grid grid-cols-3 gap-4 pt-2 border-t border-[var(--border-subtle)]">
          <div>
            <div className="font-mono text-2xl font-bold text-[var(--accent)] tabular-nums">{f.company_count}</div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Active roles</div>
          </div>
          <div>
            <div className="font-mono text-2xl font-bold text-[var(--text-primary)] tabular-nums">{f.recent_90_days ?? 0}</div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Last 90 days</div>
          </div>
          <div>
            <div className="font-mono text-2xl font-bold text-[var(--text-primary)] tabular-nums">{f.recent_30_days ?? 0}</div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Last 30 days</div>
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="section-label">AI explanation</h2>
        {anomaly.aiSummaryOutput ? (
          <div className="panel p-4 space-y-2">
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{anomaly.aiSummaryOutput}</p>
            <p className="font-mono text-[10px] text-[var(--text-muted)]">
              AI-generated · Claude Haiku
              {anomaly.aiSummaryGeneratedAt ? ` · ${formatDate(anomaly.aiSummaryGeneratedAt)}` : ""}.
              Factual summary only — no legal conclusions.
            </p>
          </div>
        ) : (
          <ExplainButton anomalyId={anomaly.id} />
        )}
      </section>

      {f.officer_id && (
        <div>
          <Link href={`/officer/${f.officer_id}`}
            className="btn-ghost text-xs">
            View full officer profile →
          </Link>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="section-label">{f.companies.length} active directorships</h2>
        <div className="panel overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Status</th>
                <th className="text-right hidden sm:table-cell">Appointed</th>
              </tr>
            </thead>
            <tbody>
              {f.companies.map((c) => (
                <tr key={c.number}>
                  <td>
                    <Link href={`/c/${c.number}`}
                      className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors">
                      {c.name}
                    </Link>
                    <div className="font-mono text-[10px] text-[var(--text-muted)] mt-0.5">{c.number}</div>
                  </td>
                  <td><StatusBadge status={c.status} /></td>
                  <td className="text-right font-mono text-xs text-[var(--text-muted)] hidden sm:table-cell">
                    {c.appointed_on ? formatDate(c.appointed_on) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

// ─── Page ──────────────────────────────────────────────────

export default async function AnomalyPage(
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const anomaly = await getAnomaly(id);
  if (!anomaly) notFound();

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-8">
      <Link href="/anomalies" className="btn-ghost text-xs">← All anomalies</Link>
      {anomaly.kind === "director_velocity"
        ? <DirectorVelocityDetail anomaly={anomaly} />
        : <AddressClusterDetail anomaly={anomaly} />
      }
    </div>
  );
}
