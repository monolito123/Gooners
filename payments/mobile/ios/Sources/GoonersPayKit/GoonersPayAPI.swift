import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// An error answer from the platform (RFC 9457 Problem Details).
public struct APIError: Error, Sendable, CustomStringConvertible {
    public let status: Int
    public let problem: Problem?

    public var description: String { "HTTP \(status) \(problem?.code ?? ""): \(problem?.detail ?? problem?.title ?? "")" }

    /// What to show a person.
    public var message: String { problem?.detail ?? problem?.title ?? "Erro \(status)" }
}

/// Refuses redirects: a session token must never follow a 3xx to another host.
private final class NoRedirects: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// The platform's merchant-app API (docs/02 §3.2, §8.2). Enrollment uses a single-use code,
/// login a NIP-98 event signed by the device key, and every later call a session token bound
/// to the Secure Enclave DPoP key. The app never holds an API key.
public final class GoonersPayAPI: Sendable {
    public let baseURL: String
    private let session: URLSession
    private let clock: @Sendable () -> Int64

    public init(baseURL: String, session: URLSession? = nil, clock: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970) }) {
        self.baseURL = baseURL.hasSuffix("/") ? String(baseURL.dropLast()) : baseURL
        self.clock = clock
        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.ephemeral // no cookies, no cache on disk
            config.timeoutIntervalForRequest = 30 // a card authorization may take the host's full timeout
            config.httpShouldSetCookies = false
            config.urlCache = nil
            self.session = URLSession(configuration: config, delegate: NoRedirects(), delegateQueue: nil)
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
    public func login(device: NostrKeys, dpop: P256Signer, deviceID: String? = nil) async throws -> Session {
        let body = try Self.encoder.encode(LoginBody(dpopJwk: dpop.publicJWK, deviceId: deviceID))
        let event = try NIP98.event(keys: device, method: "POST", url: baseURL + "/v1/auth/nostr", body: body, createdAt: clock())
        return try await send("POST", "/v1/auth/nostr", body: body, headers: ["Authorization": NIP98.header(event)])
    }

    /// A logged-in device. The device key is asked for only to sign a login and wiped right
    /// after, so between logins it stays wrapped behind the user's biometrics (docs/05 §3.6).
    public func authed(deviceKey: @escaping @Sendable () async throws -> NostrKeys, dpop: P256Signer, session: Session) -> Authed {
        Authed(api: self, deviceKey: deviceKey, dpop: dpop, session: session, now: clock)
    }

    /// A device session that logs in again when it expires or is refused.
    public actor Authed {
        private let api: GoonersPayAPI
        private let deviceKey: @Sendable () async throws -> NostrKeys
        private let dpop: P256Signer
        private let now: @Sendable () -> Int64
        public private(set) var session: Session
        private var expiresAt: Int64
        private var renewing: Task<Session, Error>?

        init(api: GoonersPayAPI, deviceKey: @escaping @Sendable () async throws -> NostrKeys, dpop: P256Signer, session: Session, now: @escaping @Sendable () -> Int64) {
            self.api = api
            self.deviceKey = deviceKey
            self.dpop = dpop
            self.session = session
            self.now = now
            expiresAt = now() + session.expiresIn
        }

        private func current() async throws -> Session {
            if now() < expiresAt - 30 { return session }
            if let r = renewing { return try await r.value } // one login, however many calls wait for it
            let (api, deviceKey, dpop, deviceID) = (api, deviceKey, dpop, session.deviceId)
            let task = Task<Session, Error> {
                let key = try await deviceKey()
                defer { key.wipe() }
                return try await api.login(device: key, dpop: dpop, deviceID: deviceID)
            }
            renewing = task
            defer { renewing = nil }
            let s = try await task.value
            session = s
            expiresAt = now() + s.expiresIn
            return s
        }

        private func call<T: Decodable>(_ method: String, _ path: String, body: Data? = nil) async throws -> T {
            func attempt(_ s: Session) async throws -> T {
                let proof = try DPoP.proof(signer: dpop, method: method, url: api.baseURL + path, accessToken: s.sessionToken, now: now())
                return try await api.send(method, path, body: body, headers: ["Authorization": "DPoP \(s.sessionToken)", "DPoP": proof])
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

        public func authorize(_ req: TerminalAuthorization) async throws -> TerminalResult {
            try await call("POST", "/v1/terminal/authorizations", body: encode(req))
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

        public func createEnrollmentCode() async throws -> EnrollmentCode {
            try await call("POST", "/v1/merchants/\(session.merchantId)/enrollment-codes")
        }

        public func registerDevice(_ body: DeviceCreate) async throws -> Device {
            try await call("POST", "/v1/merchants/\(session.merchantId)/devices", body: encode(body))
        }
    }
}
