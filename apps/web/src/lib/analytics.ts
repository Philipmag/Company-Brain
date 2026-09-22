/**
 * Lightweight server-side PostHog event capture (spec §8 observability).
 * No-ops if NEXT_PUBLIC_POSTHOG_KEY is unset.
 */
const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

export type AnalyticsEvent =
  | "onboarding_started"
  | "connector_connected"
  | "first_question_asked"
  | "feedback_given"
  | "knowledge_gap_created";

export async function captureEvent(
  event: AnalyticsEvent,
  distinctId: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  if (!POSTHOG_KEY) return;
  try {
    await fetch(`${POSTHOG_HOST}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: POSTHOG_KEY,
        event,
        distinct_id: distinctId,
        properties,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    // Never break a request for analytics.
  }
}
