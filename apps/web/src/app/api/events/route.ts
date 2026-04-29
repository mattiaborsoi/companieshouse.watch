import { NextRequest } from "next/server";
import sql from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SSE endpoint: streams recent filing events to the live ticker.
// Polls Postgres every 5 seconds and pushes new rows since the last seen id.
export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let lastIngestedAt = new Date(Date.now() - 60_000).toISOString();
      let closed = false;

      req.signal.addEventListener("abort", () => {
        closed = true;
        controller.close();
      });

      const send = (data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          closed = true;
        }
      };

      // Send a heartbeat comment every 20s to keep the connection alive
      const heartbeat = setInterval(() => {
        if (closed) { clearInterval(heartbeat); return; }
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          closed = true;
          clearInterval(heartbeat);
        }
      }, 20_000);

      while (!closed) {
        try {
          const rows = await sql`
            SELECT
              f.transaction_id,
              f.company_number,
              f.category,
              f.type,
              f.description,
              f.filing_date,
              f.ingested_at,
              c.name AS company_name
            FROM public.filings f
            JOIN public.companies c USING (company_number)
            WHERE f.ingested_at > ${lastIngestedAt}::timestamptz
            ORDER BY f.ingested_at ASC
            LIMIT 20
          `;

          if (rows.length > 0) {
            for (const row of rows) {
              send(row);
            }
            lastIngestedAt = rows[rows.length - 1].ingestedAt as string;
          }
        } catch (err) {
          // Swallow DB errors; the client will reconnect via EventSource auto-retry
          console.error("SSE DB error:", err);
        }

        // Wait 5 seconds before next poll
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 5_000);
          req.signal.addEventListener("abort", () => { clearTimeout(t); resolve(); });
        });
      }

      clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
