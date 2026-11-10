import { z } from "zod";

const flag = z.string().optional();
const nonEmpty = (min = 1) => z.string().trim().min(min);

/**
 * Production configuration contract. `validateEnv` is pure (takes an env object) so it is unit
 * tested; `assertEnv` runs it at boot from instrumentation.ts and throws one readable message
 * listing every problem, so a misconfigured container fails at startup, not on the first request.
 * Outside production nothing is required.
 */
const prodSchema = z
  .object({
    DATABASE_URL: nonEmpty().refine((v) => /^postgres(ql)?:\/\//.test(v), "must be a postgres:// URL"),
    AUTH_SECRET: nonEmpty(32),
    AUTH_URL: z.string().trim().optional(),
    AUTH_TRUST_HOST: flag,
    AUTH_DISABLED: flag,
    STORAGE_DRIVER: z.string().optional(),
    S3_BUCKET: z.string().trim().optional(),
    S3_ACCESS_KEY_ID: z.string().trim().optional(),
    S3_SECRET_ACCESS_KEY: z.string().trim().optional(),
    INNGEST_SIGNING_KEY: z.string().trim().optional(),
    DEMO_USERS: flag,
    DEMO_PASSWORD: z.string().optional(),
    S3_ENDPOINT: z.string().trim().optional(),
    S3_ALLOW_INSECURE: flag,
    AUTH_ALLOW_HTTP: flag,
    APP_ORIGINS: z.string().trim().optional(),
    TRUST_PROXY: flag,
    INTAKE_SECRET: z.string().trim().optional(),
  });

type E = Record<string, string | undefined>;

/** Cross-field rules, always evaluated (zod skips refinements once a field fails). */
function crossChecks(e: E): string[] {
  const out: string[] = [];
  const add = (path: string, message: string) => out.push(`${path}: ${message}`);
  {
    if (!e.AUTH_URL && !/^(1|true)$/i.test(e.AUTH_TRUST_HOST ?? "")) {
      add("AUTH_URL", "set AUTH_URL to the public origin (or AUTH_TRUST_HOST=1 behind a trusted proxy)");
    }
    if (e.AUTH_URL && !/^https?:\/\//.test(e.AUTH_URL)) add("AUTH_URL", "must start with http:// or https://");
    if (e.AUTH_URL && /^http:\/\//.test(e.AUTH_URL) && e.AUTH_ALLOW_HTTP !== "1") {
      add("AUTH_URL", "must be https:// in production (set AUTH_ALLOW_HTTP=1 only for a trusted http-only network)");
    }
    if (!e.APP_ORIGINS?.trim() && e.TRUST_PROXY !== "1") {
      add("APP_ORIGINS", "set APP_ORIGINS (comma-separated public origins) or TRUST_PROXY=1 behind a proxy, so CSRF origin checks and client IPs are correct");
    }
    if (e.DATABASE_URL) {
      try {
        const u = new URL(e.DATABASE_URL);
        if (decodeURIComponent(u.username) === "postgres" && decodeURIComponent(u.password) === "postgres") {
          add("DATABASE_URL", "uses the default postgres:postgres credentials; set a real password");
        }
      } catch {
        /* unparsable URLs are reported by the schema */
      }
    }
    if (e.S3_ENDPOINT && /^http:\/\//i.test(e.S3_ENDPOINT) && e.S3_ALLOW_INSECURE !== "1") {
      add("S3_ENDPOINT", "plain http endpoints are refused in production; use https:// (or S3_ALLOW_INSECURE=1 on a trusted private network)");
    }
    if (e.INTAKE_SECRET && e.INTAKE_SECRET.length < 24) add("INTAKE_SECRET", "must be at least 24 characters when set");
    if (e.DEMO_USERS === "1" && (!e.DEMO_PASSWORD || e.DEMO_PASSWORD === "ledgerline" || e.DEMO_PASSWORD.length < 12)) {
      add("DEMO_USERS", "DEMO_USERS=1 in production requires DEMO_PASSWORD (>= 12 chars, not the default)");
    }
    if (e.AUTH_DISABLED === "1") add("AUTH_DISABLED", "AUTH_DISABLED=1 is not allowed in production");
    if (e.STORAGE_DRIVER === "memory") add("STORAGE_DRIVER", "the in-memory driver loses files on restart; use S3");
    if (e.STORAGE_DRIVER !== "memory") {
      if (!e.S3_BUCKET) add("S3_BUCKET", "required when STORAGE_DRIVER is not memory");
      if (!e.S3_ACCESS_KEY_ID) add("S3_ACCESS_KEY_ID", "required when STORAGE_DRIVER is not memory");
      if (!e.S3_SECRET_ACCESS_KEY) add("S3_SECRET_ACCESS_KEY", "required when STORAGE_DRIVER is not memory");
    }
    if (!e.INNGEST_SIGNING_KEY) {
      add("INNGEST_SIGNING_KEY", "required in production: /api/inngest must verify request signatures");
    }
  }
  return out;
}

export type EnvResult = { ok: true } | { ok: false; errors: string[] };

export function validateEnv(env: Record<string, string | undefined> = process.env): EnvResult {
  if (env.NODE_ENV !== "production") return { ok: true };
  const parsed = prodSchema.safeParse(env);
  const errors = [
    ...(parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`)),
    ...crossChecks(env),
  ];
  return errors.length ? { ok: false, errors } : { ok: true };
}

export function assertEnv(env: Record<string, string | undefined> = process.env) {
  const r = validateEnv(env);
  if (!r.ok) {
    throw new Error(`Invalid production configuration:\n${r.errors.map((e) => `  - ${e}`).join("\n")}`);
  }
}

/** Boot-time check: exit instead of serving 500s forever, so orchestrators restart/flag the container. */
export function assertEnvOrExit() {
  try {
    assertEnv();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
