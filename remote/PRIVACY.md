# OmniAssist — Privacy Disclaimer

**Template for production deployment. Complete the placeholders and have it
reviewed against the privacy law that applies to you (e.g. GDPR, LGPD, CCPA)
before publishing. Not legal advice.**

_Operator: {{OPERATOR_LEGAL_NAME}} · Data contact: {{DPO_OR_CONTACT_EMAIL}}_

## Summary

- Your **screen contents, keystrokes, clipboard, and files are never sent to our
  server.** They travel directly between the two devices, end-to-end encrypted.
- Our server only helps the two devices find each other (signaling) and, if a
  direct connection is impossible, relays **encrypted** traffic it cannot read
  (TURN).
- A remote session is **never invisible** to the person using the controlled
  device.

## What the server processes

| Data | Purpose | Retention |
|---|---|---|
| Session id, 6-digit PIN (hashed), pairing state | match a controller to a device for one session | in memory; discarded when the session ends |
| SDP / ICE candidates | WebRTC negotiation | in memory; discarded after negotiation |
| Peer IP addresses + timestamps (connection log) | security, abuse investigation, accountability | {{SERVER_LOG_RETENTION, e.g. 30 days}} |
| JWT subject (device/controller id) | authenticate the WebSocket | lifetime of the token |

The server has **no cryptographic ability** to decrypt media or data-channel
contents. DTLS-SRTP keys are negotiated end-to-end; the data channel is
additionally encrypted by the clients.

## What the controlled device processes and shows

The controlled Android device keeps a **local** session log (session id,
start/end time, controller identifier, peer IP, and a summary of actions) that
**its user can view and clear**. This exists for the device owner's
accountability, not for the Operator.

## What we do not do

- We do not record, store, or view your screen.
- We do not store your files or clipboard.
- We do not profile you or sell data.
- We do not run hidden or background sessions.

## Your rights

Depending on where you live you may have rights to access, correct, or delete the
limited metadata we hold, and to object to or restrict its processing. Contact
{{DPO_OR_CONTACT_EMAIL}}. If we are your data processor (because an IT provider
operates OmniAssist to support you), direct requests to that provider:
{{CONTROLLER_CONTACT}}.

## International transfers / hosting

The signaling server is hosted on {{HOSTING_REGION, e.g. OCI region}}. Because
media is peer-to-peer, your screen data's path depends on the two devices'
networks, not on our hosting region.

## Changes

We will post changes here and update the date. Material changes affecting the
limited metadata we process will be announced {{NOTICE_METHOD}}.

_Last updated: {{EFFECTIVE_DATE}}_
