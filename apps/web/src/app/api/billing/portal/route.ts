import { optionalEnv } from "@company-brain/shared";
import { requireRole } from "@/lib/auth";
import { handle, json, errorJson } from "@/lib/api";
import { billingEnabled, getStripe } from "@/lib/billing";

/** Create a Stripe Customer Portal session for plan management (spec §9). */
export async function POST() {
  return handle(async () => {
    if (!billingEnabled) return errorJson("Billing is disabled", 400);
    const { org } = await requireRole(["admin"]);
    if (!org.stripe_customer_id) return errorJson("No billing account yet", 400);

    const appUrl = optionalEnv("APP_URL", "http://localhost:3000");
    const portal = await getStripe().billingPortal.sessions.create({
      customer: org.stripe_customer_id,
      return_url: `${appUrl}/admin`,
    });
    return json({ url: portal.url });
  });
}
