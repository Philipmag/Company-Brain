/**
 * Service-role Supabase client for server + worker use.
 *
 * IMPORTANT: this client bypasses Row-Level Security. Use it only in trusted
 * server contexts (API route handlers, the worker). When acting on behalf of a
 * specific user, always scope queries by org_id and visibility groups yourself,
 * or use the request-scoped (anon + JWT) client in the web app which enforces
 * RLS automatically.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env.js";

let adminClient: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient {
  if (!adminClient) {
    adminClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return adminClient;
}
