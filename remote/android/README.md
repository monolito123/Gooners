# OmniAssist Android client

The device side. It is built **consent-first**: the pieces that make a session
visible and agreed-to are not optional features layered on top — they are the
only path through which capture can start or continue.

## What is in this increment

| File | Role |
|---|---|
| `MainActivity` | Shows the device's session ID and the rotating 6-digit PIN, a big Start/Stop control, and the unattended-access opt-in (sets a local password). Nothing is captured from here. |
| `ConsentActivity` | The **mandatory** full-screen consent modal. Shows the exact warning and `Accept` / `Reject`. A session reaches `active` only if the user taps **Accept**; the result is what the client reports to the server as consent. |
| `SessionService` | A **foreground service** (`mediaProjection` type) that owns the screen capture and the WebRTC connection. Android forces it to post a persistent notification; this service additionally draws the on-screen banner. If the notification or the banner cannot be shown, capture does not start. Stopping it (from the notification, the banner, or the app) ends the session immediately. |
| `OverlayController` | The always-visible floating banner: *"⚠️ Remote Assistance Active — your screen is being viewed/controlled"*, with an **End** button. Drawn via `TYPE_APPLICATION_OVERLAY`. |
| `SignalingClient` | WebSocket client to the OmniAssist server: registers the device, receives the rotating PIN, receives `consent:request`, reports consent, relays WebRTC signaling. |
| `WebRtcSession` | WebRTC peer. Captures the screen with `ScreenCapturerAndroid` (fed by `MediaProjection`), sends it to the controller, and adapts resolution/frame-rate to network conditions. Opens the `control` data channel. |
| `Prefs` | Encrypted storage for the unattended-access password (hashed; `EncryptedSharedPreferences`). The password never leaves the device and is never sent to the server. |

## Deliberately **not** in this client

- No stealth/hidden mode, no way to suppress the notification or banner, no
  fake-crash concealment. These would turn it into spyware; they are out of
  scope permanently.
- **Input injection** (acting on the pointer/keyboard events the controller
  sends over the `control` channel) is the **next increment**. In this build the
  channel is received and the events are logged but not executed. When added, it
  will run only while `SessionService` is active and the banner is showing — it
  is bound to the visible session, never a standalone accessibility component.

## The consent invariant, in code

1. `SessionService.start()` requires a valid `MediaProjection` result (the user
   already saw the system "Start recording / casting?" dialog) **and** succeeds
   in posting its foreground notification, **and** succeeds in adding the overlay
   banner. If any step fails, it calls `stopSelf()` and no frame is captured.
2. For **attended** sessions, `WebRtcSession` is not created until
   `ConsentActivity` returns `Accept` and the client has sent
   `{type:"device:consent", accepted:true}` for that exact session id.
3. For **unattended** sessions, the client verifies the controller-supplied
   password against the local hash in `Prefs`; only on a match does it report
   consent. The banner and notification still show for the whole session.

## Build

Standard Gradle Android project (AGP 8.5+, Kotlin 2.0+, `minSdk 26`,
`targetSdk 35`). WebRTC comes from the `io.github.webrtc-sdk:android` artifact.

```bash
cd android
./gradlew assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
```

Permissions requested at runtime: screen capture (MediaProjection system
dialog), notifications (`POST_NOTIFICATIONS`, Android 13+), and overlay
(`SYSTEM_ALERT_WINDOW`, sent to Settings on first run). The service declares
`FOREGROUND_SERVICE_MEDIA_PROJECTION`.

> This client cannot be built or run inside this environment (no Android SDK /
> device here). The sources are structured to compile against the toolchain
> above; treat the first on-device build as the integration checkpoint.

## Configuration

Set the signaling server URL in `MainActivity` (or `local.properties` →
`BuildConfig`). Use `wss://` in production so signaling is encrypted in transit;
media is always encrypted end-to-end regardless.
