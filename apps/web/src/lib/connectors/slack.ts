import { createHmac, timingSafeEqual } from "node:crypto";
import { requireEnv } from "@company-brain/shared";

/**
 * Verify a Slack request signature (spec §5 / §7).
 * https://api.slack.com/authentication/verifying-requests-from-slack
 */
export function verifySlackSignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
): boolean {
  if (!timestamp || !signature) return false;
  // Reject requests older than 5 minutes (replay protection).
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (Number.isNaN(age) || age > 300) return false;

  const signingSecret = requireEnv("SLACK_SIGNING_SECRET");
  const base = `v0:${timestamp}:${rawBody}`;
  const computed =
    "v0=" + createHmac("sha256", signingSecret).update(base).digest("hex");

  const a = Buffer.from(computed);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Parse application/x-www-form-urlencoded Slack payloads. */
export function parseSlackForm(rawBody: string): Record<string, string> {
  const params = new URLSearchParams(rawBody);
  const out: Record<string, string> = {};
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}
