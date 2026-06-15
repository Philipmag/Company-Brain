/**
 * Auth + authorization helpers. All role checks happen server-side against the
 * `users` table (spec §8 security) — never trust a client-supplied role.
 */
import { createClient } from "@/lib/supabase/server";
import type { AppUser, Organization, UserRole } from "@company-brain/shared";

export interface SessionContext {
  authUserId: string;
  user: AppUser;
  org: Organization;
}

/** Returns the authenticated auth user id, or null if not signed in. */
export async function getAuthUserId(): Promise<string | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * Full session context (auth user + app user row + org). Returns null when the
 * user is not signed in or has not completed org creation yet.
 */
export async function getSession(): Promise<SessionContext | null> {
  const supabase = createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return null;

  const { data: user } = await supabase
    .from("users")
    .select("*")
    .eq("id", authUser.id)
    .maybeSingle<AppUser>();
  if (!user) return null;

  const { data: org } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", user.org_id)
    .maybeSingle<Organization>();
  if (!org) return null;

  return { authUserId: authUser.id, user, org };
}

export class AuthError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Require a signed-in user with a completed org. Throws AuthError otherwise. */
export async function requireSession(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) throw new AuthError("Not authenticated", 401);
  return session;
}

export async function requireRole(
  roles: UserRole[],
): Promise<SessionContext> {
  const session = await requireSession();
  if (!roles.includes(session.user.role)) {
    throw new AuthError("Forbidden", 403);
  }
  return session;
}
