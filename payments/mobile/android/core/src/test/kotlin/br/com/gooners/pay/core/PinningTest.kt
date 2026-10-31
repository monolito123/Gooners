package br.com.gooners.pay.core

import br.com.gooners.pay.core.api.GoonersPayApi
import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.CertificatePinner
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetAddress
import javax.net.ssl.SSLPeerUnverifiedException

class PinningTest {
    // localhost resolves to 127.0.0.1 and ::1 on some machines; OkHttp then reports the refused
    // address's ConnectException instead of the pinning failure. One address keeps it exact.
    private val loopback = InetAddress.getByAddress("localhost", byteArrayOf(127, 0, 0, 1))

    /** A TLS server whose certificate a client trusts, as a public CA would make it. */
    private fun serve(body: String, block: (String, MockWebServer, HeldCertificate, HandshakeCertificates) -> Unit) {
        val root = HeldCertificate.Builder().certificateAuthority(0).build()
        val leaf = HeldCertificate.Builder().addSubjectAlternativeName("localhost").signedBy(root).build()
        val server = MockWebServer()
        server.useHttps(HandshakeCertificates.Builder().heldCertificate(leaf).build().sslSocketFactory())
        server.enqueue(MockResponse.Builder().code(200).body(body).build())
        server.start(loopback, 0)
        val trust = HandshakeCertificates.Builder().addTrustedCertificate(root.certificate).build()
        try {
            block("https://localhost:${server.port}/", server, leaf, trust)
        } finally {
            server.close()
        }
    }

    private fun client(trust: HandshakeCertificates, pins: List<String>) = GoonersPayApi.defaultClient("localhost", pins).newBuilder()
        .sslSocketFactory(trust.sslSocketFactory(), trust.trustManager)
        .dns { listOf(loopback) }
        .build()

    @Test
    fun thePinnedKeyIsAccepted() = serve("""{"merchant_id":"m","trade_name":"t","expires_at":"x"}""") { url, _, leaf, trust ->
        val api = GoonersPayApi(url, client(trust, listOf(CertificatePinner.pin(leaf.certificate))))
        assertEquals("m", runBlocking { api.lookupEnrollment("CODE") }.merchantId)
    }

    @Test
    fun anotherKeyIsRefusedEvenWhenTheCAIsTrusted() = serve("{}") { url, server, _, trust ->
        val stranger = HeldCertificate.Builder().build()
        val api = GoonersPayApi(url, client(trust, listOf(CertificatePinner.pin(stranger.certificate))))
        val e = runCatching { runBlocking { api.lookupEnrollment("CODE") } }.exceptionOrNull()
        assertTrue("$e", e is SSLPeerUnverifiedException)
        assertEquals(0, server.requestCount) // nothing (no code, no token) reached the server
    }
}
