import { NextResponse } from "next/server";
import sql from "@/lib/db";

export const dynamic = "force-dynamic";

const CH_NUMBER_RE = /^[A-Z]{0,2}[0-9]{6,8}$/;

interface FaviconRow {
  contentType: string;
  bytes: Buffer;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ number: string }> },
) {
  const { number } = await params;
  const cn = number.toUpperCase();
  if (!CH_NUMBER_RE.test(cn)) {
    return NextResponse.json({ error: "invalid_company_number" }, { status: 400 });
  }
  const rows = await sql<FaviconRow[]>`
    SELECT content_type, bytes
    FROM public.company_favicons
    WHERE company_number = ${cn}
  `;
  if (rows.length === 0) {
    return new NextResponse(null, { status: 404 });
  }
  const { contentType, bytes } = rows[0];
  // Convert pg bytea (Buffer) to Uint8Array for Response
  const body = new Uint8Array(bytes);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": contentType,
      // 7-day fresh, 30-day stale-while-revalidate. The resolver re-fetches
      // every 60-180 days, so favicon bytes are effectively immutable for
      // the whole 7-day window.
      "cache-control": "public, max-age=604800, stale-while-revalidate=2592000",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    },
  });
}
