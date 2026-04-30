import { ImageResponse } from "next/og";
import { getCompany, getCompanyFilings, getCompanyOfficers } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ number: string }> }
) {
  const { number } = await params;
  const cn = number.toUpperCase();

  const [company, filings, officers] = await Promise.all([
    getCompany(cn),
    getCompanyFilings(cn),
    getCompanyOfficers(cn),
  ]);

  const name = company?.name ?? cn;
  const status = company?.status ?? "unknown";
  const incorporated = company?.incorporatedOn
    ? new Date(company.incorporatedOn).toLocaleDateString("en-GB", {
        day: "numeric", month: "short", year: "numeric",
      })
    : null;

  const isActive = status === "active";
  const statusColor = isActive ? "#34d399" : status === "dissolved" ? "#71717a" : "#fb923c";

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          flexDirection: "column",
          background: "#0a0a0f",
          fontFamily: "monospace",
          padding: "60px",
          position: "relative",
        }}
      >
        {/* Top bar */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "48px" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#22d3ee" }} />
          <span style={{ color: "#22d3ee", fontSize: "14px", letterSpacing: "0.15em", textTransform: "uppercase" }}>
            companieshouse.watch
          </span>
        </div>

        {/* Company name */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: "16px" }}>
          <div style={{ fontSize: "48px", fontWeight: "bold", color: "#f4f4f5", lineHeight: 1.1, maxWidth: "900px" }}>
            {name.length > 60 ? name.slice(0, 57) + "…" : name}
          </div>

          {/* Status + number row */}
          <div style={{ display: "flex", alignItems: "center", gap: "16px", marginTop: "8px" }}>
            <div style={{
              display: "flex", alignItems: "center", gap: "6px",
              border: `1px solid ${statusColor}`,
              borderRadius: "4px",
              padding: "4px 10px",
            }}>
              <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: statusColor }} />
              <span style={{ color: statusColor, fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                {status}
              </span>
            </div>
            <span style={{ color: "#52525b", fontSize: "14px", letterSpacing: "0.05em" }}>{cn}</span>
          </div>
        </div>

        {/* Stats row */}
        <div style={{
          display: "flex",
          gap: "0px",
          borderTop: "1px solid #27272a",
          paddingTop: "32px",
          marginTop: "32px",
        }}>
          {[
            { label: "Incorporated", value: incorporated ?? "—" },
            { label: "Filings", value: filings.length.toString() },
            { label: "Officers", value: officers.length.toString() },
          ].map((stat, i) => (
            <div key={i} style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              borderRight: i < 2 ? "1px solid #27272a" : "none",
              paddingRight: i < 2 ? "40px" : "0",
              paddingLeft: i > 0 ? "40px" : "0",
            }}>
              <div style={{ color: "#71717a", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.15em" }}>
                {stat.label}
              </div>
              <div style={{ color: "#22d3ee", fontSize: "28px", fontWeight: "bold" }}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
