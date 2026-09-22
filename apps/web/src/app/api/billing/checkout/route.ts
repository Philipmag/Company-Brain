import { type NextRequest } from "next/server";
import { getAdminClient, optionalEnv } from "@company-brain/shared";
import { requireRole } from "@/lib/auth";
import { handle, json, errorJson } from "@/lib/api";
import { billingEnabled, getStripe, priceForTier } from "@/lib/billing";

interface Body {
  tier: "starter" | "team";
}

/** Create a Stripe Checkout session for an upgrade (spec §9). */
export async function POST(request: NextRequest) {
  return handle(async () => {
    if (!billingEnabled) return errorJson("Billing is disabled", 400);
    const { org, user } = await requireRole(["admin"]);
    const body = (await request.json()) as Body;
    const price = priceForTier(body.tier);
    if (!price) return errorJson("Price not configured", 400);

    const stripe = getStripe();
    const appUrl = optionalEnv("APP_URL", "http://localhost:3000");

    let customerId = org.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { orgId: org.id },
      });
      customerId = customer.id;
      await getAdminClient()
        .from("organizations")
        .update({ stripe_customer_id: customerId })
        .eq("id", org.id);
    }

    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price, quantity: 1 }],
      success_url: `${appUrl}/admin?billing=success`,
      cancel_url: `${appUrl}/admin?billing=cancel`,
      metadata: { orgId: org.id },
    });

    return json({ url: checkout.url });
  });
}
