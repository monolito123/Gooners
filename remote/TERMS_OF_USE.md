# OmniAssist — Terms of Use & End User License Agreement

**Template for production deployment. Have it reviewed by a qualified lawyer in
your jurisdiction before you publish or ship it. It is not legal advice.**

_Last updated: {{EFFECTIVE_DATE}} · Operator: {{OPERATOR_LEGAL_NAME}} ·
Contact: {{CONTACT_EMAIL}}_

## 1. What OmniAssist is

OmniAssist is remote-assistance software. With it, a person using the
**Controller** (a web browser) can view and, when enabled, control an Android
device running the **Client**, for the purpose of technical support and
administration.

## 2. Lawful use only — the core condition

You may use OmniAssist **only** to access a device that:

- **you own**, or
- you have **explicit, informed, and current authorization** from the device's
  owner and primary user to access, for a stated support or administration
  purpose.

By starting or accepting a session you represent that this condition is met.

## 3. Prohibited uses

You must **not** use OmniAssist, or any part of its code, to:

1. Access, view, or control any device **without the informed consent** of the
   person who uses it.
2. Conduct **covert monitoring, surveillance, or "stalkerware"** of any kind,
   including monitoring a partner, family member, employee, or child in a way
   they have not been clearly told about and agreed to.
3. **Circumvent, disable, hide, or weaken** the consent prompt, the persistent
   notification, the on-screen session banner, or any other transparency
   mechanism — in the software or by modifying it.
4. Intercept communications or capture data in violation of wiretapping,
   computer-misuse, or privacy law (for example, in various jurisdictions: the
   US Computer Fraud and Abuse Act and the Wiretap Act, the EU **GDPR**, Brazil's
   **LGPD** and Marco Civil da Internet, the UK Computer Misuse Act, and
   equivalents elsewhere).
5. Access the account, financial, health, or other sensitive data of another
   person beyond what the authorized support task requires.
6. Resell, sublicense, or operate the software as a service to third parties
   without a separate written agreement with the Operator.

Violation terminates your license immediately and may be a criminal offense.

## 4. Consent and transparency are built in

OmniAssist is engineered so that:

- a session **cannot begin** until the device user physically taps **Accept** on
  the device for that session (except where **unattended access** has been
  deliberately enabled on that device by its owner, who set a local password);
- while a session is active the device **always** shows a persistent
  system notification and an on-screen banner stating that the device is being
  viewed or controlled;
- the device user can **end the session at any time** from the notification or
  banner, with one tap, without the controller's cooperation.

You agree not to defeat these mechanisms. Doing so is both a breach of these
Terms and, in many places, a separate offense.

## 5. Unattended access

Unattended access (connecting without a per-session tap) may be enabled **only**
on a device whose owner has, on that device:

- read and accepted the unattended-access warning, and
- set an unattended-access password.

Unattended access does **not** hide the session: the notification and banner
still appear for the entire connection. Enabling unattended access on a device
you do not own, or without the owner's informed instruction, is prohibited under
Section 3.

## 6. Data

The Operator's server performs signaling and NAT traversal only. It does **not**
receive, store, or have the ability to decrypt screen contents, keystrokes,
files, or clipboard data, which travel end-to-end encrypted between the two
devices. See [`PRIVACY.md`](PRIVACY.md). Session **metadata** (session id,
start/end time, peer IP addresses, and connection events) may be logged on the
**controlled device** and/or the Operator's server for security and
accountability; the controlled device's user can view the on-device log.

## 7. No warranty; limitation of liability

The software is provided "as is", without warranty of any kind. To the maximum
extent permitted by law, the Operator is not liable for indirect, incidental, or
consequential damages. Nothing here excludes liability that cannot be excluded by
law.

## 8. Your responsibility

You are solely responsible for how you use the software and for complying with
all laws applicable to you and to the person whose device you access, including
obtaining any consent those laws require. The Operator is not responsible for
your unlawful use.

## 9. Termination

The Operator may suspend or terminate access for any suspected violation of these
Terms.

## 10. Governing law

These Terms are governed by the laws of {{GOVERNING_JURISDICTION}}, without regard
to conflict-of-laws rules. {{DISPUTE_RESOLUTION_CLAUSE}}

---

_Placeholders in `{{...}}` must be completed before deployment._
