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
      // 7-day immutable cache; the resolver re-fetches periodically and
      // updates the row, so a fresh request will get the new bytes after
      // the cache expires. The URL itself doesn't change per company so
      // we don't need cache-busting via the path.
      "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    },
  });
}
