/**
 * Typed environment access. Throws a clear error when a required variable is
 * missing rather than failing deep inside a request handler.
 */

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function optionalEnv(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export function boolEnv(name: string, fallback = false): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export const env = {
  get supabaseUrl(): string {
    return requireEnv("SUPABASE_URL");
  },
  get supabaseServiceRoleKey(): string {
    return requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  },
  get supabaseAnonKey(): string {
    return requireEnv("SUPABASE_ANON_KEY");
  },
  get openaiApiKey(): string {
    return requireEnv("OPENAI_API_KEY");
  },
  get anthropicApiKey(): string {
    return requireEnv("ANTHROPIC_API_KEY");
  },
  get cohereApiKey(): string {
    return requireEnv("COHERE_API_KEY");
  },
  get redisUrl(): string {
    return optionalEnv("REDIS_URL", "redis://localhost:6379");
  },
  get encryptionKey(): string {
    return requireEnv("ENCRYPTION_KEY");
  },
  get billingEnabled(): boolean {
    return boolEnv("BILLING_ENABLED", false);
  },
  get appUrl(): string {
    return optionalEnv("APP_URL", "http://localhost:3000");
  },
};
