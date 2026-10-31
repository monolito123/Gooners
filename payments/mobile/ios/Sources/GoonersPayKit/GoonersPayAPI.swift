import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(Security)
import Security
#endif

/// An error answer from the platform (RFC 9457 Problem Details).
public struct APIError: Error, Sendable, CustomStringConvertible {
    public let status: Int
    public let problem: Problem?

    public var description: String { "HTTP \(status) \(problem?.code ?? ""): \(problem?.detail ?? problem?.title ?? "")" }

    /// What to show a person.
    public var message: String { problem?.detail ?? problem?.title ?? "Erro \(status)" }

    /// The platform wants this device's attestation with the login (an owner-added phone).
    public var attestationRequired: Bool { status == 401 && (problem?.detail ?? "").contains("attestation_required") }
}

/// Refuses redirects (a session token must never follow a 3xx to another host) and, with
/// pins, accepts the pinned host only when a pinned key is in its trusted chain.
private final class SessionDelegate: NSObject, URLSessionTaskDelegate, Sendable {
    let pins: CertificatePins?

    init(pins: CertificatePins?) { self.pins = pins }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    #if canImport(Security)
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping @Sendable (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard let pins, challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              challenge.protectionSpace.host == pins.host, let trust = challenge.protectionSpace.serverTrust else {
            return completionHandler(.performDefaultHandling, nil)
        }
        // The chain must first be trusted as usual; pinning only narrows it.
        guard SecTrustEvaluateWithError(trust, nil), let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate] else {
            return completionHandler(.cancelAuthenticationChallenge, nil)
        }
        for cert in chain {
            guard let key = SecCertificateCopyKey(cert), let attrs = SecKeyCopyAttributes(key) as? [String: Any],
                  let external = SecKeyCopyExternalRepresentation(key, nil) as Data? else { continue }
            let type: CertificatePins.KeyType = (attrs[kSecAttrKeyType as String] as? String) == (kSecAttrKeyTypeRSA as String) ? .rsa : .ec
            let bits = (attrs[kSecAttrKeySizeInBits as String] as? Int) ?? 0
            if let pin = CertificatePins.pin(keyType: type, bits: bits, external: external), pins.pins.contains(pin) {
                return completionHandler(.useCredential, URLCredential(trust: trust))
            }
        }
        completionHandler(.cancelAuthenticationChallenge, nil)
    }
    #endif
}

/// The platform's merchant-app API (docs/02 §3.2, §8.2). Enrollment uses a single-use code,
/// login a NIP-98 event signed by the device key, and every later call a session token bound
/// to the Secure Enclave DPoP key. The app never holds an API key.
public final class GoonersPayAPI: Sendable {
    public let baseURL: String
    private let session: URLSession
    private let clock: @Sendable () -> Int64

    public init(baseURL: String, session: URLSession? = nil, clock: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970) },
                pins: CertificatePins? = nil) {
        self.baseURL = baseURL.hasSuffix("/") ? String(baseURL.dropLast()) : baseURL
        self.clock = clock
        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.ephemeral // no cookies, no cache on disk
            config.timeoutIntervalForRequest = 30 // a card authorization may take the host's full timeout
            config.httpShouldSetCookies = false
            config.urlCache = nil
            self.session = URLSession(configuration: config, delegate: SessionDelegate(pins: pins), delegateQueue: nil)
        }
    }

    static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.keyEncodingStrategy = .convertToSnakeCase
        return e
    }()

    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()

    func send<T: Decodable>(_ method: String, _ path: String, body: Data?, headers: [String: String]) async throws -> T {
        guard let url = URL(string: baseURL + path) else { throw URLError(.badURL) }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.httpBody = body
        if body != nil { req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if method == "POST" { req.setValue(UUID().uuidString.lowercased(), forHTTPHeaderField: "Idempotency-Key") }
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError(status: http.statusCode, problem: try? Self.decoder.decode(Problem.self, from: data))
        }
        return try Self.decoder.decode(T.self, from: data)
    }

    // MARK: enrollment and login (no session yet)

    public func lookupEnrollment(code: String) async throws -> Enrollment {
        try await send("GET", "/v1/enrollment", body: nil, headers: ["Authorization": "Enrollment \(code)"])
    }

    public func enroll(code: String, _ body: DeviceCreate) async throws -> Device {
        try await send("POST", "/v1/enrollment", body: Self.encoder.encode(body), headers: ["Authorization": "Enrollment \(code)"])
    }

    /// POST /v1/auth/nostr: the body is sent exactly as its hash was signed.
    public func login(device: NostrKeys, dpop: P256Signer, deviceID: String? = nil, attestation: [String: String]? = nil) async throws -> Session {
        let body = try Self.encoder.encode(LoginBody(dpopJwk: dpop.publicJWK, deviceId: deviceID, attestation: attestation))
        let event = try NIP98.event(keys: device, method: "POST", url: baseURL + "/v1/auth/nostr", body: body, createdAt: clock())
        return try await send("POST", "/v1/auth/nostr", body: body, headers: ["Authorization": NIP98.header(event)])
    }

    /// A logged-in device. The device key is asked for only to sign a login and wiped right
    /// after, so between logins it stays wrapped behind the user's biometrics (docs/05 §3.6).
    /// `onKey` runs while the device key is unwrapped for a login: it signs pending journal entries.
    public func authed(deviceKey: @escaping @Sendable () async throws -> NostrKeys, dpop: P256Signer, session: Session,
                       onKey: @escaping @Sendable (NostrKeys) -> Void = { _ in }) -> Authed {
        Authed(api: self, deviceKey: deviceKey, dpop: dpop, session: session, now: clock, onKey: onKey)
    }

    /// A device session that logs in again when it expires or is refused.
    public actor Authed {
        private let api: GoonersPayAPI
        private let deviceKey: @Sendable () async throws -> NostrKeys
        private let dpop: P256Signer
        private let now: @Sendable () -> Int64
        private let onKey: @Sendable (NostrKeys) -> Void
        public private(set) var session: Session
        private var expiresAt: Int64
        private var renewing: Task<Session, Error>?
        private var assertionSigner: (@Sendable (Data) async throws -> Data)?

        init(api: GoonersPayAPI, deviceKey: @escaping @Sendable () async throws -> NostrKeys, dpop: P256Signer, session: Session,
             now: @escaping @Sendable () -> Int64, onKey: @escaping @Sendable (NostrKeys) -> Void) {
            self.api = api
            self.onKey = onKey
            self.deviceKey = deviceKey
            self.dpop = dpop
            self.session = session
            self.now = now
            expiresAt = now() + session.expiresIn
        }

        private func current() async throws -> Session {
            if now() < expiresAt - 30 { return session }
            if let r = renewing { return try await r.value } // one login, however many calls wait for it
            let (api, deviceKey, dpop, deviceID, onKey) = (api, deviceKey, dpop, session.deviceId, onKey)
            let task = Task<Session, Error> {
                let key = try await deviceKey()
                defer { key.wipe() }
                let s = try await api.login(device: key, dpop: dpop, deviceID: deviceID)
                onKey(key)
                return s
            }
            renewing = task
            defer { renewing = nil }
            let s = try await task.value
            session = s
            expiresAt = now() + s.expiresIn
            return s
        }

        private func call<T: Decodable>(_ method: String, _ path: String, body: Data? = nil, headers extra: [String: String] = [:]) async throws -> T {
            func attempt(_ s: Session) async throws -> T {
                let proof = try DPoP.proof(signer: dpop, method: method, url: api.baseURL + path, accessToken: s.sessionToken, now: now())
                let headers = extra.merging(["Authorization": "DPoP \(s.sessionToken)", "DPoP": proof]) { _, auth in auth }
                return try await api.send(method, path, body: body, headers: headers)
            }
            do {
                return try await attempt(current())
            } catch let e as APIError where e.status == 401 {
                expiresAt = 0 // the session was revoked or expired early: log in again once
                return try await attempt(current())
            }
        }

        private func encode<B: Encodable>(_ b: B) throws -> Data { try GoonersPayAPI.encoder.encode(b) }

        public func merchant() async throws -> Merchant { try await call("GET", "/v1/merchants/\(session.merchantId)") }

        public func createIntent(_ req: IntentCreate) async throws -> PaymentIntent {
            try await call("POST", "/v1/payment-intents", body: encode(req))
        }

        public func intent(_ id: String) async throws -> PaymentIntent { try await call("GET", "/v1/payment-intents/\(id)") }

        public func confirmPix(_ id: String) async throws -> PaymentIntent {
            try await call("POST", "/v1/payment-intents/\(id)/confirm", body: Data(#"{"payment_method_type":"pix"}"#.utf8))
        }

        public func cancel(_ id: String) async throws -> PaymentIntent { try await call("POST", "/v1/payment-intents/\(id)/cancel") }

        public func confirmCrypto(_ id: String, asset: String, network: String) async throws -> PaymentIntent {
            try await call("POST", "/v1/payment-intents/\(id)/confirm", body: encode(CryptoConfirm(asset: asset, network: network)))
        }

        /// Gives a captured Pix or crypto sale back to the payer ("Cancelar venda").
        public func refund(_ intentID: String, amount: Int64) async throws -> Refund {
            try await call("POST", "/v1/refunds", body: encode(RefundCreate(paymentIntentId: intentID, amount: amount)))
        }

        /// The sandbox only: the customer's transfer arrives.
        public func simulateCryptoPayment(_ id: String) async throws -> PaymentIntent { try await call("POST", "/v1/sandbox/crypto/payments/\(id)") }

        public func holdings() async throws -> Holdings { try await call("GET", "/v1/holdings") }

        public func internationalAccounts() async throws -> InternationalAccounts { try await call("GET", "/v1/international/accounts") }

        public func portfolio() async throws -> Portfolio { try await call("GET", "/v1/investments/positions") }

        public func quoteConversion(_ req: ConversionRequest) async throws -> Conversion {
            try await call("POST", "/v1/conversions", body: encode(req))
        }

        public func executeConversion(_ id: String) async throws -> Conversion { try await call("POST", "/v1/conversions/\(id)/execute") }

        /// Signs every card authorization with the App Attest key (iOS): `signer` gets
        /// SHA-256 of the exact request body and returns the assertion (DCAppAttestService).
        public func signAuthorizations(with signer: @escaping @Sendable (Data) async throws -> Data) {
            assertionSigner = signer
        }

        public func authorize(_ req: TerminalAuthorization) async throws -> TerminalResult {
            let body = try encode(req)
            var headers: [String: String] = [:]
            if let sign = assertionSigner {
                headers["App-Attest-Assertion"] = try await sign(sha256(body)).base64EncodedString()
            }
            return try await call("POST", "/v1/terminal/authorizations", body: body, headers: headers)
        }

        public func balance() async throws -> Balance { try await call("GET", "/v1/accounts/\(session.accountId)/balance") }

        public func entries(limit: Int = 20) async throws -> Entries {
            try await call("GET", "/v1/accounts/\(session.accountId)/entries?limit=\(limit)")
        }

        public func quote(amount: Int64, destination: PixDestination) async throws -> Quote {
            try await call("POST", "/v1/payouts/quotes", body: encode(QuoteRequest(accountId: session.accountId, amount: amount, destination: destination)))
        }

        public func payout(quoteID: String) async throws -> Payout {
            try await call("POST", "/v1/payouts", body: encode(PayoutRequest(quoteId: quoteID)))
        }

        public func uploadJournal(_ entries: [NostrEvent]) async throws -> JournalStatus {
            try await call("POST", "/v1/terminal/journal", body: encode(JournalUpload(entries: entries)))
        }

        public func journalState() async throws -> JournalStatus { try await call("GET", "/v1/terminal/journal") }

        /// The merchant's daily statements, newest day first (docs/03 §6).
        public func settlements(limit: Int = 30) async throws -> Settlements { try await call("GET", "/v1/settlements?limit=\(limit)") }

        /// The signed kind 7713 statement of a settlement.
        public func statement(_ settlementId: String) async throws -> NostrEvent { try await call("GET", "/v1/settlements/\(settlementId)/statement") }

        /// A receipt's inclusion proof in its statement and the statement's in the public root.
        public func proof(_ settlementId: String, receipt: String) async throws -> InclusionProof {
            try await call("GET", "/v1/settlements/\(settlementId)/proofs/\(receipt)")
        }

        /// The day's public transparency root (kind 7715). Public: anyone can fetch it.
        public func transparencyRoot(_ date: String) async throws -> TransparencyRoot { try await call("GET", "/v1/transparency/\(date)") }

        /// Fetches a settlement's statement and its day's public root, and checks them on the phone.
        public func verifiedStatement(_ settlement: Settlement, platformKeys: Set<String> = []) async throws -> Statement {
            let event = try await statement(settlement.id)
            let root = try await transparencyRoot(settlement.date)
            return try Statement.verify(statement: event, root: root.event, merchantId: session.merchantId, platformKeys: platformKeys)
        }

        /// Uploads the journal's signed entries; nil when there was nothing to send.
        @discardableResult
        public func syncJournal(_ journal: Journal) async throws -> JournalStatus? {
            let entries = journal.toUpload()
            if entries.isEmpty { return nil }
            let status = try await uploadJournal(entries)
            journal.record(sent: entries, status: status)
            return status
        }

        public func createEnrollmentCode() async throws -> EnrollmentCode {
            try await call("POST", "/v1/merchants/\(session.merchantId)/enrollment-codes")
        }

        public func registerDevice(_ body: DeviceCreate) async throws -> Device {
            try await call("POST", "/v1/merchants/\(session.merchantId)/devices", body: encode(body))
        }
    }
}
