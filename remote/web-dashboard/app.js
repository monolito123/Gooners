// OmniAssist — browser controller.
//
// Talks to the signaling server over WebSocket, negotiates a WebRTC connection
// directly with the device, renders the device screen, and sends control events
// over an encrypted data channel. The server only relays SDP/ICE; media and
// control never pass through it.
//
// The device acts on the control events it receives (input-control layer is the
// next increment). This side already captures and transmits them in a stable
// schema so the two sides are wire-compatible.

const $ = (id) => document.getElementById(id);

const ui = {
  connState: $("conn-state"),
  panelConnect: $("panel-connect"),
  panelSession: $("panel-session"),
  serverUrl: $("server-url"),
  deviceId: $("device-id"),
  pin: $("pin"),
  unattended: $("unattended"),
  btnConnect: $("btn-connect"),
  connectMsg: $("connect-msg"),
  banner: $("session-banner"),
  bannerText: $("session-banner-text"),
  btnEnd: $("btn-end"),
  btnClipboard: $("btn-clipboard"),
  video: $("remote-video"),
  stageOverlay: $("stage-overlay"),
  statLatency: $("stat-latency"),
  statRes: $("stat-res"),
  statFps: $("stat-fps"),
  statMode: $("stat-mode"),
};

const state = {
  ws: null,
  pc: null,
  control: null, // RTCDataChannel
  sessionId: null,
  mode: "attended",
  statsTimer: null,
  lastBytes: 0,
  lastFrames: 0,
  lastTs: 0,
};

function setConn(kind, text) {
  ui.connState.className = "pill " + ({ idle: "pill-idle", ok: "pill-ok", wait: "pill-wait", err: "pill-err" }[kind] || "pill-idle");
  ui.connState.textContent = text;
}
function say(text, kind = "") {
  ui.connectMsg.textContent = text;
  ui.connectMsg.className = "msg " + kind;
}

function wsToHttp(u) {
  return u.replace(/^ws/, "http").replace(/\/+$/, "");
}

async function getToken(httpBase) {
  const r = await fetch(`${httpBase}/token?role=controller`, { method: "POST" });
  if (!r.ok) throw new Error(`token ${r.status}`);
  return r.json();
}
async function getIce(httpBase) {
  const r = await fetch(`${httpBase}/ice`);
  if (!r.ok) throw new Error(`ice ${r.status}`);
  return (await r.json()).iceServers;
}

ui.btnConnect.addEventListener("click", connect);

async function connect() {
  const wsBase = ui.serverUrl.value.trim().replace(/\/+$/, "");
  const httpBase = wsToHttp(wsBase);
  const deviceId = ui.deviceId.value.replace(/\s+/g, "");
  const pin = ui.pin.value.replace(/\s+/g, "");
  const unattended = ui.unattended.checked;

  if (!deviceId) return say("Enter the session ID.", "err");
  if (!unattended && !/^\d{6}$/.test(pin)) return say("PIN must be 6 digits.", "err");

  ui.btnConnect.disabled = true;
  say("Requesting a token…");
  try {
    const { token } = await getToken(httpBase);
    state.iceServers = await getIce(httpBase);

    const ws = new WebSocket(`${wsBase}/?token=${encodeURIComponent(token)}`);
    state.ws = ws;
    setConn("wait", "Connecting…");

    ws.onopen = () => say("Connected to server. Waiting to pair…");
    ws.onerror = () => { say("Could not reach the signaling server.", "err"); ui.btnConnect.disabled = false; };
    ws.onclose = () => { if (!state.sessionId) { setConn("idle", "Not connected"); ui.btnConnect.disabled = false; } };
    ws.onmessage = (ev) => onServerMsg(JSON.parse(ev.data), { deviceId, pin, unattended });
  } catch (e) {
    say(`Failed: ${e.message}`, "err");
    ui.btnConnect.disabled = false;
  }
}

function onServerMsg(msg, intent) {
  switch (msg.type) {
    case "hello":
      if (intent.unattended) {
        send({ type: "controller:pair-unattended", deviceId: intent.deviceId });
      } else {
        send({ type: "controller:pair", deviceId: intent.deviceId, pin: intent.pin });
      }
      break;

    case "pair:pending":
      state.sessionId = msg.sessionId;
      setConn("wait", "Waiting for device");
      say(intent.unattended
        ? "Waiting for the device to verify the unattended password…"
        : "Waiting for the person at the device to tap Accept…");
      break;

    case "pair:rejected":
      say(`Cannot pair: ${friendly(msg.error)}`, "err");
      ui.btnConnect.disabled = false;
      break;

    case "session:active":
      startSession();
      break;

    case "signal":
      handleSignal(msg.data);
      break;

    case "session:ended":
      endLocal(`Session ended: ${friendly(msg.reason)}`);
      break;

    case "replaced":
      endLocal("This controller was replaced by a newer connection.");
      break;

    case "error":
      say(`Server error: ${friendly(msg.error)}`, "err");
      break;
  }
}

function friendly(code) {
  return ({
    pin_invalid: "wrong PIN",
    pin_expired: "the PIN expired — ask for the current one",
    device_offline: "the device is offline",
    device_busy: "the device is already in a session",
    unattended_disabled: "unattended access is not enabled on that device",
    capacity: "the server is at capacity",
    device_rejected: "the device declined",
    device_ended: "ended by the device",
    controller_left: "the controller disconnected",
    timeout: "timed out",
  }[code] || code);
}

function send(obj) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(obj));
}

/* ----------------------------- WebRTC ----------------------------- */

async function startSession() {
  ui.panelConnect.classList.add("hidden");
  ui.panelSession.classList.remove("hidden");
  setConn("ok", "Live session");
  ui.bannerText.textContent = `Live — session ${formatId(state.sessionId)} (${state.mode})`;

  const pc = new RTCPeerConnection({ iceServers: state.iceServers });
  state.pc = pc;

  // Control channel (ordered, reliable): pointer/keyboard/clipboard events.
  const control = pc.createDataChannel("control", { ordered: true });
  state.control = control;
  control.onopen = () => bindInput();
  control.onmessage = (e) => onControlReply(e.data);

  pc.ontrack = (ev) => {
    ui.video.srcObject = ev.streams[0];
    ui.stageOverlay.classList.add("hidden");
  };
  pc.onicecandidate = (ev) => {
    if (ev.candidate) send({ type: "signal", sessionId: state.sessionId, data: { kind: "candidate", candidate: ev.candidate } });
  };
  pc.onconnectionstatechange = () => {
    if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
      setConn("err", `Peer ${pc.connectionState}`);
    }
  };

  // We only receive video; the device sends it.
  pc.addTransceiver("video", { direction: "recvonly" });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  send({ type: "signal", sessionId: state.sessionId, data: { kind: "offer", sdp: pc.localDescription } });

  startStats();
}

async function handleSignal(data) {
  const pc = state.pc;
  if (!pc || !data) return;
  if (data.kind === "answer") {
    await pc.setRemoteDescription(data.sdp);
  } else if (data.kind === "candidate") {
    try { await pc.addIceCandidate(data.candidate); } catch { /* ignore late candidates */ }
  }
}

/* --------------------------- control I/O --------------------------- */
// Coordinates are normalised to 0..1 over the displayed video content so the
// device can map them to its own resolution regardless of scaling.

function videoPoint(ev) {
  const r = ui.video.getBoundingClientRect();
  const vw = ui.video.videoWidth || r.width;
  const vh = ui.video.videoHeight || r.height;
  // account for object-fit: contain letterboxing
  const scale = Math.min(r.width / vw, r.height / vh);
  const dispW = vw * scale, dispH = vh * scale;
  const offX = (r.width - dispW) / 2, offY = (r.height - dispH) / 2;
  const x = (ev.clientX - r.left - offX) / dispW;
  const y = (ev.clientY - r.top - offY) / dispH;
  return { x: clamp01(x), y: clamp01(y), inside: x >= 0 && x <= 1 && y >= 0 && y <= 1 };
}
const clamp01 = (n) => Math.max(0, Math.min(1, n));

function ctl(obj) {
  if (state.control && state.control.readyState === "open") {
    state.control.send(JSON.stringify(obj));
  }
}

function bindInput() {
  const v = ui.video;
  v.tabIndex = 0;
  v.addEventListener("pointerdown", (e) => { const p = videoPoint(e); if (p.inside) { v.focus(); ctl({ k: "pointer", a: "down", x: p.x, y: p.y, b: e.button }); } });
  v.addEventListener("pointermove", (e) => { const p = videoPoint(e); if (p.inside) ctl({ k: "pointer", a: "move", x: p.x, y: p.y }); });
  v.addEventListener("pointerup", (e) => { const p = videoPoint(e); ctl({ k: "pointer", a: "up", x: p.x, y: p.y, b: e.button }); });
  v.addEventListener("wheel", (e) => { e.preventDefault(); const p = videoPoint(e); if (p.inside) ctl({ k: "scroll", x: p.x, y: p.y, dx: e.deltaX, dy: e.deltaY }); }, { passive: false });
  v.addEventListener("contextmenu", (e) => e.preventDefault());
  v.addEventListener("keydown", (e) => { e.preventDefault(); ctl({ k: "key", a: "down", key: e.key, code: e.code, mods: modMask(e) }); });
  v.addEventListener("keyup", (e) => { e.preventDefault(); ctl({ k: "key", a: "up", key: e.key, code: e.code, mods: modMask(e) }); });
}
function modMask(e) {
  return (e.ctrlKey ? 1 : 0) | (e.altKey ? 2 : 0) | (e.shiftKey ? 4 : 0) | (e.metaKey ? 8 : 0);
}

function onControlReply(data) {
  // Device → controller control-channel messages (e.g. clipboard mirror, ack).
  try {
    const m = JSON.parse(data);
    if (m.k === "clipboard" && typeof m.text === "string") {
      navigator.clipboard?.writeText(m.text).catch(() => {});
    }
  } catch { /* ignore */ }
}

ui.btnClipboard.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) ctl({ k: "clipboard", text });
  } catch { say("Clipboard read was blocked by the browser.", "err"); }
});

/* ----------------------------- stats ------------------------------ */

function startStats() {
  state.statsTimer = setInterval(async () => {
    if (!state.pc) return;
    const stats = await state.pc.getStats();
    let rtt, w, h, frames, now = performance.now();
    stats.forEach((r) => {
      if (r.type === "candidate-pair" && r.state === "succeeded" && r.currentRoundTripTime != null) rtt = r.currentRoundTripTime * 1000;
      if (r.type === "inbound-rtp" && r.kind === "video") {
        w = r.frameWidth; h = r.frameHeight; frames = r.framesDecoded;
      }
    });
    if (rtt != null) ui.statLatency.textContent = `RTT ${Math.round(rtt)} ms`;
    if (w && h) ui.statRes.textContent = `${w} × ${h}`;
    if (frames != null && state.lastTs) {
      const fps = ((frames - state.lastFrames) / ((now - state.lastTs) / 1000));
      ui.statFps.textContent = `${Math.max(0, Math.round(fps))} fps`;
    }
    state.lastFrames = frames ?? state.lastFrames;
    state.lastTs = now;
    ui.statMode.textContent = state.mode === "unattended" ? "unattended" : "attended";
  }, 1000);
}

/* --------------------------- lifecycle ---------------------------- */

ui.btnEnd.addEventListener("click", () => {
  if (state.sessionId) send({ type: "end", sessionId: state.sessionId });
  endLocal("You ended the session.");
});

function endLocal(reason) {
  clearInterval(state.statsTimer);
  state.statsTimer = null;
  try { state.pc?.close(); } catch { /* */ }
  try { state.ws?.close(); } catch { /* */ }
  state.pc = state.control = state.ws = null;
  const sid = state.sessionId;
  state.sessionId = null;
  ui.panelSession.classList.add("hidden");
  ui.panelConnect.classList.remove("hidden");
  ui.video.srcObject = null;
  ui.stageOverlay.classList.remove("hidden");
  ui.btnConnect.disabled = false;
  setConn("idle", "Not connected");
  say(reason + (sid ? ` (${formatId(sid)})` : ""), "ok");
}

function formatId(id) {
  return String(id || "").replace(/(\d{3})(?=\d)/g, "$1 ").trim();
}

window.addEventListener("beforeunload", () => {
  if (state.sessionId) send({ type: "end", sessionId: state.sessionId });
});
