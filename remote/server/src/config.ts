/**
 * Environment-driven configuration. Fails fast on missing secrets in production.
 */

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new Error(`Env ${name} must be an integer`);
  return n;
}

function str(name: string, fallback?: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Env ${name} is required`);
  }
  return raw;
}

const isProd = process.env.NODE_ENV === "production";

export const config = {
  isProd,
  port: int("PORT", 8080),

  jwtSecret: (() => {
    const s = str("JWT_SECRET", isProd ? undefined : "dev-insecure-secret-change-me");
    if (isProd && s.length < 32) throw new Error("JWT_SECRET too short for production");
    return s;
  })(),
  jwtTtlSeconds: int("JWT_TTL_SECONDS", 3600),

  sessionTtlSeconds: int("SESSION_TTL_SECONDS", 7200),
  pairingTtlSeconds: int("PAIRING_TTL_SECONDS", 120),
  pinRotateSeconds: int("PIN_ROTATE_SECONDS", 30),

  allowedOrigins: str("ALLOWED_ORIGINS", "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),

  turn: {
    url: str("TURN_URL", "stun:stun.l.google.com:19302"),
    staticSecret: str("TURN_STATIC_SECRET", "dev-turn-secret"),
    credTtlSeconds: int("TURN_CRED_TTL_SECONDS", 600),
    stunUrl: str("STUN_URL", "stun:stun.l.google.com:19302"),
  },

  maxSessions: int("MAX_SESSIONS", 200),
} as const;

export type Config = typeof config;
