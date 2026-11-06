/**
 * OmniAssist signaling & session server.
 *
 * Responsibilities (and ONLY these):
 *   - issue short-lived JWTs and ephemeral TURN credentials
 *   - register online devices and advertise their rotating 6-digit PIN
 *   - pair a controller to a device ONLY after the device consents
 *   - relay WebRTC signaling (SDP/ICE) between the two paired peers
 *
 * It never sees screen frames, input, clipboard or files: those go peer-to-peer
 * over WebRTC (DTLS-SRTP + an app-level encrypted data channel). If this process
 * dies, established media keeps flowing; only new pairing is interrupted.
 */

import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "./config.js";
import { issueToken, verifyToken, turnCredentials, newPrincipalId, type Role } from "./auth.js";
import { SessionManager } from "./sessions.js";

const sessions = new SessionManager();

/* ------------------------------------------------------------------ *
 * HTTP: health, token issuance, TURN credentials, ICE config
 * ------------------------------------------------------------------ */

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(data);
}

function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // native app clients send no Origin
  return config.allowedOrigins.includes(origin);
}

const httpServer = http.createServer((req, res) => {
  const origin = req.headers.origin;
  if (origin && config.allowedOrigins.includes(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "origin");
    res.setHeader("access-control-allow-headers", "content-type");
    res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/healthz") {
    send(res, 200, { ok: true, ...sessions.stats() });
    return;
  }

  // Issue a token for a device or controller. In production put real auth in
  // front of this (account login, support-org SSO, device enrollment). Here a
  // fresh principal id is minted for anonymous attended use.
  if (req.method === "POST" && url.pathname === "/token") {
    if (!originAllowed(origin)) return send(res, 403, { error: "origin" });
    const roleParam = url.searchParams.get("role");
    const role: Role = roleParam === "device" ? "device" : "controller";
    const sub = url.searchParams.get("id") || newPrincipalId(role === "device" ? "dev" : "ctl");
    return send(res, 200, {
      token: issueToken({ sub, role }),
      id: sub,
      role,
      expiresInSeconds: config.jwtTtlSeconds,
    });
  }

  // ICE servers (STUN + ephemeral TURN). Clients fetch this per session.
  if (req.method === "GET" && url.pathname === "/ice") {
    const turn = turnCredentials();
    return send(res, 200, {
      iceServers: [
        { urls: config.turn.stunUrl },
        { urls: turn.urls, username: turn.username, credential: turn.credential },
      ],
    });
  }

  send(res, 404, { error: "not_found" });
});

/* ------------------------------------------------------------------ *
 * WebSocket signaling
 * ------------------------------------------------------------------ */

interface Client {
  ws: WebSocket;
  id: string;
  role: Role;
  sessionId: string | null;
  alive: boolean;
}

const clients = new Map<string, Client>(); // principalId -> Client
const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  // Validate token and (for browsers) Origin before accepting the socket.
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const token = url.searchParams.get("token") ?? "";
  const origin = req.headers.origin;
  if (origin && !config.allowedOrigins.includes(origin)) {
    socket.destroy();
    return;
  }
  let claims;
  try {
    claims = verifyToken(token);
  } catch {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, claims);
  });
});

type ClientMsg =
  // device
  | { type: "device:online"; unattendedEnabled?: boolean }
  | { type: "device:consent"; sessionId: string; accepted: boolean }
  // controller
  | { type: "controller:pair"; deviceId: string; pin: string }
  | { type: "controller:pair-unattended"; deviceId: string }
  // either, once active: opaque WebRTC signaling relayed to the peer
  | { type: "signal"; sessionId: string; data: unknown }
  | { type: "end"; sessionId: string }
  | { type: "pong" };

function safeSend(c: Client | undefined, msg: unknown): void {
  if (c && c.ws.readyState === WebSocket.OPEN) {
    c.ws.send(JSON.stringify(msg));
  }
}

function peerOf(session: { deviceId: string; controllerId: string | null }, selfId: string): Client | undefined {
  const peerId = session.deviceId === selfId ? session.controllerId : session.deviceId;
  return peerId ? clients.get(peerId) : undefined;
}

wss.on("connection", (ws: WebSocket, claims: { sub: string; role: Role }) => {
  // One connection per principal; replace a stale one.
  const prev = clients.get(claims.sub);
  if (prev) {
    safeSend(prev, { type: "replaced" });
    prev.ws.close(4000, "replaced");
  }
  const client: Client = { ws, id: claims.sub, role: claims.role, sessionId: null, alive: true };
  clients.set(claims.sub, client);
  safeSend(client, { type: "hello", id: client.id, role: client.role });

  ws.on("pong", () => (client.alive = true));

  ws.on("message", (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return safeSend(client, { type: "error", error: "bad_json" });
    }
    handle(client, msg);
  });

  ws.on("close", () => {
    clients.delete(client.id);
    if (client.role === "device") {
      const ended = sessions.deviceOffline(client.id);
      if (ended) safeSend(peerOf(ended, client.id), { type: "session:ended", reason: ended.endReason });
    } else if (client.sessionId) {
      const ended = sessions.endSession(client.sessionId, "controller_left");
      if (ended) safeSend(peerOf(ended, client.id), { type: "session:ended", reason: "controller_left" });
    }
  });
});

function handle(client: Client, msg: ClientMsg): void {
  switch (msg.type) {
    case "pong":
      client.alive = true;
      return;

    /* ---- device ---- */
    case "device:online": {
      if (client.role !== "device") return safeSend(client, { type: "error", error: "role" });
      const reg = sessions.registerDevice(client.id, Boolean(msg.unattendedEnabled));
      return safeSend(client, {
        type: "device:registered",
        deviceId: reg.deviceId,
        pin: reg.pin,
        pinExpiresAt: reg.pinExpiresAt,
        rotateSeconds: config.pinRotateSeconds,
      });
    }

    case "device:consent": {
      if (client.role !== "device") return safeSend(client, { type: "error", error: "role" });
      const r = sessions.deviceConsent(client.id, msg.sessionId, msg.accepted);
      if (!r.ok) return safeSend(client, { type: "error", error: r.error });
      client.sessionId = r.session.phase === "active" ? r.session.id : null;
      const peer = peerOf(r.session, client.id);
      if (r.session.phase === "active") {
        // Tell both peers they may begin WebRTC negotiation.
        safeSend(client, { type: "session:active", sessionId: r.session.id, role: "device" });
        safeSend(peer, { type: "session:active", sessionId: r.session.id, role: "controller" });
      } else {
        safeSend(peer, { type: "session:ended", reason: "device_rejected" });
      }
      return;
    }

    /* ---- controller ---- */
    case "controller:pair": {
      if (client.role !== "controller") return safeSend(client, { type: "error", error: "role" });
      const r = sessions.requestPairing(client.id, msg.deviceId, String(msg.pin ?? ""));
      if (!r.ok) return safeSend(client, { type: "pair:rejected", error: r.error });
      client.sessionId = r.session.id;
      safeSend(client, { type: "pair:pending", sessionId: r.session.id });
      // Ask the device to show the consent prompt for this session.
      safeSend(clients.get(msg.deviceId), {
        type: "consent:request",
        sessionId: r.session.id,
        controllerId: client.id,
        mode: "attended",
      });
      return;
    }

    case "controller:pair-unattended": {
      if (client.role !== "controller") return safeSend(client, { type: "error", error: "role" });
      const r = sessions.requestUnattended(client.id, msg.deviceId);
      if (!r.ok) return safeSend(client, { type: "pair:rejected", error: r.error });
      client.sessionId = r.session.id;
      safeSend(client, { type: "pair:pending", sessionId: r.session.id });
      // Device will verify the unattended password locally, then report consent.
      safeSend(clients.get(msg.deviceId), {
        type: "consent:request",
        sessionId: r.session.id,
        controllerId: client.id,
        mode: "unattended",
      });
      return;
    }

    /* ---- relayed signaling (only between the two paired, consented peers) ---- */
    case "signal": {
      const s = sessions.participantOf(msg.sessionId, client.id);
      if (!s || s.phase !== "active") return safeSend(client, { type: "error", error: "not_active" });
      // The server does not inspect `data`; it only forwards SDP/ICE to the peer.
      safeSend(peerOf(s, client.id), { type: "signal", sessionId: s.id, data: msg.data });
      return;
    }

    case "end": {
      const s = sessions.participantOf(msg.sessionId, client.id);
      if (!s) return;
      const reason = client.role === "device" ? "device_ended" : "controller_left";
      const ended = sessions.endSession(s.id, reason);
      client.sessionId = null;
      if (ended) {
        safeSend(client, { type: "session:ended", reason });
        safeSend(peerOf(ended, client.id), { type: "session:ended", reason });
      }
      return;
    }

    default:
      safeSend(client, { type: "error", error: "unknown_type" });
  }
}

/* ------------------------------------------------------------------ *
 * Timers: PIN rotation, session reaping, WS keepalive
 * ------------------------------------------------------------------ */

setInterval(() => {
  for (const reg of sessions.rotateExpiredPins()) {
    safeSend(clients.get(reg.deviceId), {
      type: "device:pin",
      pin: reg.pin,
      pinExpiresAt: reg.pinExpiresAt,
    });
  }
}, 1000).unref?.();

setInterval(() => {
  for (const ended of sessions.reapExpired()) {
    safeSend(clients.get(ended.deviceId), { type: "session:ended", reason: "timeout" });
    if (ended.controllerId) safeSend(clients.get(ended.controllerId), { type: "session:ended", reason: "timeout" });
  }
}, 5000).unref?.();

setInterval(() => {
  for (const c of clients.values()) {
    if (!c.alive) {
      c.ws.terminate();
      continue;
    }
    c.alive = false;
    try {
      c.ws.ping();
    } catch {
      /* ignore */
    }
  }
}, 30_000).unref?.();

httpServer.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`OmniAssist signaling server on :${config.port} (prod=${config.isProd})`);
});
