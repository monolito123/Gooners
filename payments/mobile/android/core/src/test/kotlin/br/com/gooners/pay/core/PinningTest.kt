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
import javax.net.ssl.SSLPeerUnverifiedException

class PinningTest {
    /** A TLS server whose certificate a client trusts, as a public CA would make it. */
    private fun serve(body: String, block: (MockWebServer, HeldCertificate, HandshakeCertificates) -> Unit) {
        val root = HeldCertificate.Builder().certificateAuthority(0).build()
        val leaf = HeldCertificate.Builder().addSubjectAlternativeName("localhost").signedBy(root).build()
        val server = MockWebServer()
        server.useHttps(HandshakeCertificates.Builder().heldCertificate(leaf).build().sslSocketFactory())
        server.enqueue(MockResponse.Builder().code(200).body(body).build())
        server.start()
        val trust = HandshakeCertificates.Builder().addTrustedCertificate(root.certificate).build()
        try {
            block(server, leaf, trust)
        } finally {
            server.close()
        }
    }

    private fun client(trust: HandshakeCertificates, pins: List<String>) = GoonersPayApi.defaultClient("localhost", pins).newBuilder()
        .sslSocketFactory(trust.sslSocketFactory(), trust.trustManager).build()

    @Test
    fun thePinnedKeyIsAccepted() = serve("""{"merchant_id":"m","trade_name":"t","expires_at":"x"}""") { server, leaf, trust ->
        val api = GoonersPayApi(server.url("/").toString(), client(trust, listOf(CertificatePinner.pin(leaf.certificate))))
        assertEquals("m", runBlocking { api.lookupEnrollment("CODE") }.merchantId)
    }

    @Test
    fun anotherKeyIsRefusedEvenWhenTheCAIsTrusted() = serve("{}") { server, _, trust ->
        val stranger = HeldCertificate.Builder().build()
        val api = GoonersPayApi(server.url("/").toString(), client(trust, listOf(CertificatePinner.pin(stranger.certificate))))
        val e = runCatching { runBlocking { api.lookupEnrollment("CODE") } }.exceptionOrNull()
        assertTrue("$e", e is SSLPeerUnverifiedException)
        assertEquals(0, server.requestCount) // nothing (no code, no token) reached the server
    }
}
