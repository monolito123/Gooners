/**
 * JWT issuance and verification, plus ephemeral TURN credentials.
 *
 * Two token roles exist: "device" (the Android client) and "controller" (the
 * browser). A token binds a connection to a role and a stable principal id; the
 * session state machine (sessions.ts) decides what that principal may do.
 */

import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "./config.js";

export type Role = "device" | "controller";

export interface TokenClaims {
  sub: string; // principal id (device id or controller id)
  role: Role;
}

export function issueToken(claims: TokenClaims): string {
  return jwt.sign(claims, config.jwtSecret, {
    expiresIn: config.jwtTtlSeconds,
    issuer: "omniassist",
  });
}

export function verifyToken(token: string): TokenClaims {
  const decoded = jwt.verify(token, config.jwtSecret, { issuer: "omniassist" });
  if (typeof decoded !== "object" || decoded === null) throw new Error("bad token");
  const { sub, role } = decoded as Record<string, unknown>;
  if (typeof sub !== "string" || (role !== "device" && role !== "controller")) {
    throw new Error("bad token claims");
  }
  return { sub, role };
}

/**
 * Coturn "static-auth-secret" (TURN REST API) ephemeral credentials.
 * username = "<expiryUnix>", password = base64(HMAC-SHA1(secret, username)).
 * Clients get short-lived TURN creds without the server storing per-user state.
 */
export function turnCredentials(): {
  urls: string[];
  username: string;
  credential: string;
} {
  const expiry = Math.floor(Date.now() / 1000) + config.turn.credTtlSeconds;
  const username = String(expiry);
  const hmac = crypto.createHmac("sha1", config.turn.staticSecret);
  hmac.update(username);
  const credential = hmac.digest("base64");
  const urls = [config.turn.url];
  if (config.turn.stunUrl && config.turn.stunUrl !== config.turn.url) {
    urls.unshift(config.turn.stunUrl);
  }
  return { urls, username, credential };
}

/** Random, URL-safe principal id for first-time devices/controllers. */
export function newPrincipalId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(9).toString("base64url")}`;
}
