import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function errorJson(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** Wrap a route handler, translating AuthError + unexpected errors to JSON. */
export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AuthError) return errorJson(err.message, err.status);
    console.error("[api] unhandled error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return errorJson(message, 500);
  }
}
