/**
 * Application-layer encryption for OAuth tokens (spec §8 security).
 * AES-256-GCM. The key comes from the ENCRYPTION_KEY env var (32 bytes,
 * hex-encoded => 64 hex chars).
 *
 * Wire format (base64): [12-byte IV][16-byte auth tag][ciphertext]
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { requireEnv } from "./env.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const hex = requireEnv("ENCRYPTION_KEY");
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) {
    throw new Error(
      "ENCRYPTION_KEY must be 32 bytes hex-encoded (64 hex chars). " +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return key;
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decrypt(payload: string): string {
  const key = getKey();
  const data = Buffer.from(payload, "base64");
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Encrypt a value that may be null/undefined (returns null if input is empty). */
export function encryptNullable(value: string | null | undefined): string | null {
  if (!value) return null;
  return encrypt(value);
}

export function decryptNullable(value: string | null | undefined): string | null {
  if (!value) return null;
  return decrypt(value);
}
