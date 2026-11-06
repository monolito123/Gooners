// Integration test for the OmniAssist signaling server.
//
// Spawns the server on a random port and drives a simulated device + controller
// through the WebSocket protocol, asserting the consent invariant and PIN gating.
//
// Run:  node test/flow.mjs   (after `npm run build`)

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const PORT = 8100 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const WS = `ws://127.0.0.1:${PORT}`;
const serverPath = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/server.js");

const server = spawn(process.execPath, [serverPath], {
  env: { ...process.env, PORT: String(PORT), JWT_SECRET: "test", TURN_STATIC_SECRET: "test", PIN_ROTATE_SECONDS: "300" },
  stdio: "ignore",
});

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}: ${m}`); };

const token = async (role, id) => {
  const u = new URL(`${BASE}/token`);
  u.searchParams.set("role", role);
  if (id) u.searchParams.set("id", id);
  return (await (await fetch(u, { method: "POST" })).json()).token;
};
const open = (t) => new Promise((r, j) => {
  const ws = new WebSocket(`${WS}/?token=${t}`);
  ws.on("open", () => r(ws));
  ws.on("error", j);
});
// Attach the collector BEFORE sending, to avoid races with immediate replies.
const collect = (ws) => {
  const q = [];
  const waiters = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    const i = waiters.findIndex((w) => w.pred(m));
    if (i >= 0) waiters.splice(i, 1)[0].res(m);
    else q.push(m);
  });
  return (pred) => {
    const i = q.findIndex(pred);
    if (i >= 0) return Promise.resolve(q.splice(i, 1)[0]);
    return new Promise((res) => waiters.push({ pred, res }));
  };
};
const waitHealthy = async () => {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not become healthy");
};

try {
  await waitHealthy();

  const dev = await open(await token("device", "dev_it"));
  const devMsg = collect(dev);
  dev.send(JSON.stringify({ type: "device:online", unattendedEnabled: false }));
  const reg = await devMsg((m) => m.type === "device:registered");
  ok(/^\d{6}$/.test(reg.pin), `device advertises a 6-digit PIN`);

  // wrong PIN
  const c1 = await open(await token("controller"));
  const c1Msg = collect(c1);
  await c1Msg((m) => m.type === "hello");
  c1.send(JSON.stringify({ type: "controller:pair", deviceId: reg.deviceId, pin: reg.pin === "000000" ? "111111" : "000000" }));
  ok((await c1Msg((m) => m.type === "pair:rejected")).error === "pin_invalid", "wrong PIN rejected");
  c1.close();

  // correct PIN pends; controller must NOT be active before consent
  const c2 = await open(await token("controller"));
  const c2Msg = collect(c2);
  let active = false;
  c2.on("message", (raw) => { if (JSON.parse(raw).type === "session:active") active = true; });
  await c2Msg((m) => m.type === "hello");
  c2.send(JSON.stringify({ type: "controller:pair", deviceId: reg.deviceId, pin: reg.pin }));
  const pend = await c2Msg((m) => m.type === "pair:pending");
  ok(!!pend.sessionId, "correct PIN -> pair:pending");
  const cr = await devMsg((m) => m.type === "consent:request");
  ok(cr.sessionId === pend.sessionId, "device gets consent:request");
  await new Promise((r) => setTimeout(r, 150));
  ok(active === false, "INVARIANT: controller not active before device consents");

  // accept -> active -> relay works
  dev.send(JSON.stringify({ type: "device:consent", sessionId: pend.sessionId, accepted: true }));
  ok((await c2Msg((m) => m.type === "session:active")).sessionId === pend.sessionId, "Accept -> session:active");
  const relayed = devMsg((m) => m.type === "signal");
  c2.send(JSON.stringify({ type: "signal", sessionId: pend.sessionId, data: { kind: "offer" } }));
  ok((await relayed).data.kind === "offer", "signaling relayed only when active");
  c2.send(JSON.stringify({ type: "end", sessionId: pend.sessionId }));
  dev.close(); c2.close();
} catch (e) {
  fail++; console.log("FAIL (exception):", e.message);
} finally {
  server.kill();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
