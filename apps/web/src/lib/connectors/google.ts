import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { requireEnv, optionalEnv } from "@company-brain/shared";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

export function createOAuthClient(): OAuth2Client {
  return new google.auth.OAuth2(
    requireEnv("GOOGLE_CLIENT_ID"),
    requireEnv("GOOGLE_CLIENT_SECRET"),
    optionalEnv(
      "GOOGLE_REDIRECT_URI",
      "http://localhost:3000/api/connections/google/callback",
    ),
  );
}

export function driveFor(client: OAuth2Client) {
  return google.drive({ version: "v3", auth: client });
}
