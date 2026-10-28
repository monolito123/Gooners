package br.com.gooners.pdf

import java.io.File

object Fixtures {
    fun file(name: String): File {
        val url = javaClass.classLoader!!.getResource("fixtures/$name") ?: error("fixture $name ausente")
        val tmp = File.createTempFile("fixture", "_" + name)
        url.openStream().use { i -> tmp.outputStream().use { i.copyTo(it) } }
        return tmp
    }

    fun tmp(name: String): File = File(createTempDir(), name)

    @Suppress("DEPRECATION")
    private fun createTempDir(): File = kotlin.io.createTempDir("gpdf")
}
