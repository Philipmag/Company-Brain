import { type NextRequest } from "next/server";
import type Stripe from "stripe";
import { getAdminClient, optionalEnv } from "@company-brain/shared";
import { billingEnabled, getStripe, PRICE_TO_TIER } from "@/lib/billing";

export const dynamic = "force-dynamic";

/**
 * Stripe webhook (spec §9). Updates organizations.plan_tier + stripe_customer_id
 * on subscription changes. No-ops when billing is disabled.
 */
export async function POST(request: NextRequest) {
  if (!billingEnabled) return new Response("billing disabled", { status: 200 });

  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  const secret = optionalEnv("STRIPE_WEBHOOK_SECRET");
  if (!signature || !secret) return new Response("missing signature", { status: 400 });

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    return new Response(`invalid signature: ${(err as Error).message}`, { status: 400 });
  }

  const admin = getAdminClient();

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated"
  ) {
    const sub = event.data.object as Stripe.Subscription;
    const priceId = sub.items.data[0]?.price.id;
    const tier = priceId ? PRICE_TO_TIER[priceId] : undefined;
    if (tier) {
      await admin
        .from("organizations")
        .update({ plan_tier: tier })
        .eq("stripe_customer_id", sub.customer as string);
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    await admin
      .from("organizations")
      .update({ plan_tier: "starter" })
      .eq("stripe_customer_id", sub.customer as string);
  }

  return new Response("ok");
}
