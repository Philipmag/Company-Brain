import Stripe from "stripe";
import { boolEnv, optionalEnv } from "@company-brain/shared";

export const billingEnabled = boolEnv("BILLING_ENABLED", false);

let stripe: Stripe | null = null;
export function getStripe(): Stripe {
  if (!stripe) {
    stripe = new Stripe(optionalEnv("STRIPE_SECRET_KEY"), {
      apiVersion: "2024-09-30.acacia",
    });
  }
  return stripe;
}

export const PRICE_TO_TIER: Record<string, string> = {
  [optionalEnv("STRIPE_PRICE_STARTER")]: "starter",
  [optionalEnv("STRIPE_PRICE_TEAM")]: "team",
};

export function priceForTier(tier: string): string {
  if (tier === "team") return optionalEnv("STRIPE_PRICE_TEAM");
  return optionalEnv("STRIPE_PRICE_STARTER");
}
