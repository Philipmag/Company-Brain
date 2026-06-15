import { type NextRequest } from "next/server";
import { verifySlackSignature } from "@/lib/connectors/slack";

export const dynamic = "force-dynamic";

/**
 * Slack Events API receiver (spec §5). Currently handles only the url_verification
 * handshake; channel ingestion (channels:history) is reserved for Phase 2.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const body = JSON.parse(rawBody || "{}") as {
    type?: string;
    challenge?: string;
  };

  if (body.type === "url_verification") {
    return Response.json({ challenge: body.challenge });
  }

  if (
    !verifySlackSignature(
      rawBody,
      request.headers.get("x-slack-request-timestamp"),
      request.headers.get("x-slack-signature"),
    )
  ) {
    return new Response("invalid signature", { status: 401 });
  }

  // Future: ingest channel messages into documents/chunks here.
  return new Response("ok");
}
