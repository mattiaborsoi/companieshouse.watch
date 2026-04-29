import { getRecentFilings } from "@/lib/db";
import { filingCategoryLabel, filingCategoryColor } from "@/lib/utils";

export default async function Marquee() {
  const filings = await getRecentFilings(40);
  if (filings.length < 3) return null;

  // Duplicate for seamless loop
  const items = [...filings, ...filings];

  return (
    <div
      className="border-b border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden select-none"
      style={{ height: "30px" }}
    >
      <div className="flex items-center h-full">
        <div
          className="marquee-track flex items-center gap-8 px-4"
          style={{ willChange: "transform" }}
        >
          {items.map((f, i) => (
            <span key={i} className="flex items-center gap-2 shrink-0">
              <span className={`badge border ${filingCategoryColor(f.category)}`} style={{ fontSize: "9px", padding: "1px 5px" }}>
                {filingCategoryLabel(f.category)}
              </span>
              <span className="font-mono text-[11px] text-[var(--text-secondary)] whitespace-nowrap">
                {f.companyName}
              </span>
              <span className="font-mono text-[10px] text-[var(--text-muted)]">
                {f.companyNumber}
              </span>
              <span className="text-[var(--border)] px-2">·</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
