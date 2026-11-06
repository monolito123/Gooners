/**
 * Session, PIN and consent state machine.
 *
 * Invariant this module exists to enforce:
 *
 *   A controller is never joined to a device's session until the DEVICE has
 *   reported an explicit `accepted` consent for that exact session id (attended
 *   mode), OR the device has unattended access enabled and the controller
 *   proves knowledge of the unattended password (verified device-side).
 *
 * The controller cannot set consent; only the device connection can. The server
 * holds no screen data — only the small amount of state below, all in memory.
 */

import crypto from "node:crypto";
import { config } from "./config.js";

export type Phase =
  | "registered" // device online, advertising a rotating PIN, no controller yet
  | "pairing" // controller supplied a valid PIN; waiting for device consent tap
  | "active" // consent given; peers exchanging signaling / connected
  | "ended";

export type EndReason =
  | "device_rejected"
  | "device_ended"
  | "controller_left"
  | "device_offline"
  | "timeout"
  | "replaced";

export interface ConsentMode {
  kind: "attended" | "unattended";
}

interface DeviceReg {
  deviceId: string;
  /** current 6-digit PIN (attended mode), rotated on an interval */
  pin: string;
  pinExpiresAt: number;
  unattendedEnabled: boolean;
  createdAt: number;
}

export interface Session {
  id: string;
  deviceId: string;
  controllerId: string | null;
  phase: Phase;
  mode: ConsentMode["kind"];
  createdAt: number;
  expiresAt: number;
  endReason?: EndReason;
  /** connection log kept only for the lifetime of the session, surfaced to device */
  events: Array<{ t: number; type: string; detail?: string }>;
}

function sixDigitPin(): string {
  // crypto-random, uniform over 000000..999999
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function sessionId(): string {
  // 9-digit grouped id, AnyDesk-style, easy to read aloud
  const n = crypto.randomInt(0, 1_000_000_000);
  return String(n).padStart(9, "0");
}

export class SessionManager {
  private devices = new Map<string, DeviceReg>();
  private sessions = new Map<string, Session>();
  /** deviceId -> active/pending sessionId, so a device has at most one */
  private deviceSession = new Map<string, string>();

  /** A device comes online. Returns its current PIN and rotation interval. */
  registerDevice(deviceId: string, unattendedEnabled: boolean): DeviceReg {
    const now = Date.now();
    const reg: DeviceReg = {
      deviceId,
      pin: sixDigitPin(),
      pinExpiresAt: now + config.pinRotateSeconds * 1000,
      unattendedEnabled,
      createdAt: now,
    };
    this.devices.set(deviceId, reg);
    return reg;
  }

  /** Rotate PINs that have expired. Called on a timer. Returns changed devices. */
  rotateExpiredPins(): DeviceReg[] {
    const now = Date.now();
    const changed: DeviceReg[] = [];
    for (const reg of this.devices.values()) {
      // Do not rotate while a session is pairing against the current PIN.
      const sid = this.deviceSession.get(reg.deviceId);
      const s = sid ? this.sessions.get(sid) : undefined;
      if (s && s.phase === "pairing") continue;
      if (now >= reg.pinExpiresAt) {
        reg.pin = sixDigitPin();
        reg.pinExpiresAt = now + config.pinRotateSeconds * 1000;
        changed.push(reg);
      }
    }
    return changed;
  }

  deviceOffline(deviceId: string): Session | undefined {
    this.devices.delete(deviceId);
    const sid = this.deviceSession.get(deviceId);
    if (!sid) return undefined;
    return this.endSession(sid, "device_offline");
  }

  getDevice(deviceId: string): DeviceReg | undefined {
    return this.devices.get(deviceId);
  }

  /**
   * Controller attempts to start a session against a device + PIN.
   * On success the session enters `pairing` — NOT active. The device must still
   * accept. Constant-time PIN compare; PIN must be current.
   */
  requestPairing(
    controllerId: string,
    deviceId: string,
    pin: string,
  ): { ok: true; session: Session } | { ok: false; error: string } {
    if (this.sessions.size >= config.maxSessions) {
      return { ok: false, error: "capacity" };
    }
    const reg = this.devices.get(deviceId);
    if (!reg) return { ok: false, error: "device_offline" };
    if (this.deviceSession.has(deviceId)) {
      return { ok: false, error: "device_busy" };
    }
    if (Date.now() >= reg.pinExpiresAt) return { ok: false, error: "pin_expired" };
    if (!constantTimeEqual(pin, reg.pin)) return { ok: false, error: "pin_invalid" };

    const now = Date.now();
    const session: Session = {
      id: sessionId(),
      deviceId,
      controllerId,
      phase: "pairing",
      mode: "attended",
      createdAt: now,
      expiresAt: now + config.sessionTtlSeconds * 1000,
      events: [{ t: now, type: "pairing_requested", detail: controllerId }],
    };
    this.sessions.set(session.id, session);
    this.deviceSession.set(deviceId, session.id);
    return { ok: true, session };
  }

  /**
   * Unattended pairing. The server only records intent; the DEVICE verifies the
   * unattended password locally and then calls `deviceConsent(..., accepted)`.
   * The server never sees or stores the unattended password.
   */
  requestUnattended(
    controllerId: string,
    deviceId: string,
  ): { ok: true; session: Session } | { ok: false; error: string } {
    const reg = this.devices.get(deviceId);
    if (!reg) return { ok: false, error: "device_offline" };
    if (!reg.unattendedEnabled) return { ok: false, error: "unattended_disabled" };
    if (this.deviceSession.has(deviceId)) return { ok: false, error: "device_busy" };

    const now = Date.now();
    const session: Session = {
      id: sessionId(),
      deviceId,
      controllerId,
      phase: "pairing",
      mode: "unattended",
      createdAt: now,
      expiresAt: now + config.sessionTtlSeconds * 1000,
      events: [{ t: now, type: "unattended_requested", detail: controllerId }],
    };
    this.sessions.set(session.id, session);
    this.deviceSession.set(deviceId, session.id);
    return { ok: true, session };
  }

  /**
   * The DEVICE reports the user's decision (attended: the Accept/Reject tap;
   * unattended: result of local password check). This is the ONLY path to
   * `active`. Controllers cannot call it.
   */
  deviceConsent(
    deviceId: string,
    sessionIdArg: string,
    accepted: boolean,
  ): { ok: true; session: Session } | { ok: false; error: string } {
    const s = this.sessions.get(sessionIdArg);
    if (!s || s.deviceId !== deviceId) return { ok: false, error: "no_session" };
    if (s.phase !== "pairing") return { ok: false, error: "bad_phase" };

    if (!accepted) {
      const ended = this.endSession(sessionIdArg, "device_rejected");
      return { ok: true, session: ended ?? s };
    }
    s.phase = "active";
    s.events.push({ t: Date.now(), type: "consent_accepted" });
    return { ok: true, session: s };
  }

  get(sessionIdArg: string): Session | undefined {
    return this.sessions.get(sessionIdArg);
  }

  /** Only a participant may address a session. */
  participantOf(sessionIdArg: string, principalId: string): Session | undefined {
    const s = this.sessions.get(sessionIdArg);
    if (!s) return undefined;
    if (s.deviceId === principalId || s.controllerId === principalId) return s;
    return undefined;
  }

  logEvent(sessionIdArg: string, type: string, detail?: string): void {
    const s = this.sessions.get(sessionIdArg);
    if (s) s.events.push({ t: Date.now(), type, detail });
  }

  endSession(sessionIdArg: string, reason: EndReason): Session | undefined {
    const s = this.sessions.get(sessionIdArg);
    if (!s) return undefined;
    s.phase = "ended";
    s.endReason = reason;
    s.events.push({ t: Date.now(), type: "ended", detail: reason });
    this.deviceSession.delete(s.deviceId);
    // keep the ended session briefly so both peers can read the reason, then drop
    setTimeout(() => this.sessions.delete(sessionIdArg), 10_000).unref?.();
    return s;
  }

  /** Expire sessions past their TTL. Called on a timer. */
  reapExpired(): Session[] {
    const now = Date.now();
    const ended: Session[] = [];
    for (const s of this.sessions.values()) {
      if (s.phase !== "ended" && now >= s.expiresAt) {
        const e = this.endSession(s.id, "timeout");
        if (e) ended.push(e);
      }
    }
    return ended;
  }

  stats(): { devices: number; sessions: number } {
    return { devices: this.devices.size, sessions: this.sessions.size };
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
