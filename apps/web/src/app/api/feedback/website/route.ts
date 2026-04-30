import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createHash } from "crypto";
import sql from "@/lib/db";

export const dynamic = "force-dynamic";

const CH_NUMBER_RE = /^[A-Z]{0,2}[0-9]{6,8}$/;
const MAX_NOTES_LEN = 1000;

interface Body {
  companyNumber?: string;
  reportedUrl?: string;
  notes?: string;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const cn = (body.companyNumber ?? "").toUpperCase().trim();
  if (!cn || !CH_NUMBER_RE.test(cn)) {
    return NextResponse.json({ error: "invalid_company_number" }, { status: 400 });
  }
  const reportedUrl = (body.reportedUrl ?? "").slice(0, 500);
  const notes = (body.notes ?? "").slice(0, MAX_NOTES_LEN);

  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ?? "";
  const ipHash = ip
    ? createHash("sha256").update(ip + "ch-feedback-salt").digest("hex")
    : null;

  await sql`
    INSERT INTO meta.identity_feedback
      (company_number, kind, reported_url, notes, ip_hash)
    VALUES (${cn}, 'incorrect_website', ${reportedUrl}, ${notes}, ${ipHash})
  `;

  return NextResponse.json({ ok: true });
}
