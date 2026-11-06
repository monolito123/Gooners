# OmniAssist

Transparent, consent-first remote assistance. A browser-based controller and an
Android client talk to each other over **WebRTC**; an **OCI Always Free (ARM64
Ampere A1)** server does only signaling and NAT traversal. Screen frames, input
events and files travel **peer-to-peer and encrypted** — they never touch the
server, and nothing about a session is stored off-device beyond the audit
metadata the device owner can see.

> OmniAssist is for **lawful IT support and administration of devices you own or
> are explicitly authorized to access**. It is engineered so that it *cannot* be
> used for secret monitoring: a session is impossible to start without a manual
> tap on the device, and impossible to keep running without a banner and a
> notification the controlled person can see at all times. See
> [`TERMS_OF_USE.md`](TERMS_OF_USE.md) and [`PRIVACY.md`](PRIVACY.md).

## Why this design is safe by construction

The difference between remote-support software and spyware is not the ToS — it
is whether the person on the controlled device *knows and agreed*. OmniAssist
makes that a property of the protocol, not a setting:

1. **No session without a local tap.** The server will not pair a controller to
   a device until the device reports an `accepted` consent event for that exact
   session id. The controller side cannot forge it; the server gates on it.
2. **No invisible session.** The Android client starts screen capture only from
   inside a foreground service that is *required* to post a persistent
   notification, and it draws a system overlay banner for the whole session. If
   either is dismissed or fails, capture stops. These are not toggles.
3. **No server-side recording.** The relay sees only encrypted SDP/ICE signaling
   and, when a direct path fails, opaque TURN-relayed media it cannot decrypt
   (DTLS-SRTP). Media and data channels are end-to-end encrypted between peers.
4. **Unattended access is opt-in on the device, re-confirmable, and still
   visible.** It does not remove the banner or the notification; it only removes
   the per-session *tap*, and only after the device owner sets a local unattended
   password that the controller must also know.

Features whose only purpose would be to hide a session (stealth mode, notification
suppression, fake-crash hiding, accessibility-abuse keylogging) are intentionally
**not implemented and will not be**.

## Layout

```
remote/
  README.md            this file — architecture + safety model
  TERMS_OF_USE.md      EULA / ToS, abuse prohibitions, jurisdictional notes
  PRIVACY.md           what is and is not processed, and where
  docker-compose.yml   OCI ARM64 deployment: signaling + Coturn
  server/              Node.js + TypeScript signaling & session server
    src/
      config.ts        env-driven config
      auth.ts          JWT issuance/verification
      sessions.ts      session + PIN + consent state machine
      server.ts        HTTP (token/health) + WebSocket signaling
    coturn/turnserver.conf   TURN/STUN config for NAT traversal
    Dockerfile         ARM64 (multi-arch) build
    .env.example
  web-dashboard/       browser controller (no plugin, WebRTC viewer)
    index.html
    styles.css
    app.js
  android/             consent-first Android client (Kotlin)
    README.md          module spec + build/run; capture + safety machinery
```

## Build status (incremental)

| Component | State |
|---|---|
| Signaling + session/PIN/consent server | **implemented** |
| OCI ARM64 Docker + Coturn deployment | **implemented** |
| Web controller (viewer, signaling, control channel) | **implemented** |
| Android: consent gate, foreground service, overlay watermark, screen capture | **implemented** |
| Android: input control layer (bound to the visible session) | **next increment** |
| Bidirectional file transfer, clipboard, multi-display | **next increment** |

The input-control layer is deliberately built *after* the visible-session model,
on top of it, so it is never a standalone covert component.

## Data path

```
Android device  <——WebRTC (DTLS-SRTP, E2EE data)——>  Browser controller
        \                                               /
         \——— WSS signaling (SDP/ICE only) ———> [ OCI signaling server ]
                                                 [ Coturn TURN/STUN     ] <—— fallback relay (opaque)
```

The server is stateless about media. Restart it and in-flight media keeps
flowing; only new pairing/signaling needs it.

## Low latency

Latency comes from WebRTC itself (congestion control, NACK/PLI, jitter buffer)
plus client-side adaptation: the Android encoder lowers resolution/frame rate as
`RTCRtpSender` stats report rising RTT or loss, and raises them again when the
path clears. The server adds nothing to the media path, so it adds no latency.

See each subfolder's README for build and run steps.
