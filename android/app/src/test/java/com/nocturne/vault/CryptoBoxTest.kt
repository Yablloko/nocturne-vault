package com.nocturne.vault

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue

class CryptoBoxTest {
    @Test fun `AES GCM round trip and authentication`() {
        val key = CryptoBox.randomBytes(32)
        val plain = "секретное содержимое".toByteArray()
        val blob = CryptoBox.encrypt(key, plain, "scope-a")
        assertArrayEquals(plain, CryptoBox.decrypt(key, blob, "scope-a"))
        assertThrows(Exception::class.java) { CryptoBox.decrypt(key, blob, "scope-b") }
    }

    @Test fun `RFC TOTP vector`() {
        assertEquals("94287082", Totp.code("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000, 8))
    }

    @Test fun `password policy rejects partial passwords and generator satisfies every rule`() {
        assertFalse(SecurityPolicy.isStrongMaster("onlylowercase123"))
        repeat(100) { assertTrue(SecurityPolicy.isStrongMaster(SecurityPolicy.generate())) }
    }

    @Test fun `stream encryption authenticates aad and round trips`() {
        val key = CryptoBox.randomBytes(32)
        val source = ByteArray(900_000) { (it % 239).toByte() }
        val encrypted = java.io.ByteArrayOutputStream()
        java.io.DataOutputStream(encrypted).writeInt(12)
        CryptoBox.encryptStream(key, source.inputStream(), encrypted, "stream-a", source.size.toLong())
        val plain = java.io.ByteArrayOutputStream()
        CryptoBox.decryptStream(key, encrypted.toByteArray().inputStream(), plain, "stream-a")
        assertArrayEquals(source, plain.toByteArray())
        assertThrows(Exception::class.java) { CryptoBox.decryptStream(key, encrypted.toByteArray().inputStream(), java.io.ByteArrayOutputStream(), "stream-b") }
    }

    @Test fun `tampered stream fails authentication`() {
        val key = CryptoBox.randomBytes(32)
        val encrypted = java.io.ByteArrayOutputStream()
        java.io.DataOutputStream(encrypted).writeInt(12)
        CryptoBox.encryptStream(key, "authenticated payload".byteInputStream(), encrypted, "file", 1024)
        val tampered = encrypted.toByteArray().also { it[it.lastIndex - 4] = (it[it.lastIndex - 4].toInt() xor 1).toByte() }
        assertThrows(Exception::class.java) {
            CryptoBox.decryptStream(key, tampered.inputStream(), java.io.ByteArrayOutputStream(), "file")
        }
    }

    @Test fun `autofill save draft is one time only`() {
        val token = AutofillPendingStore.put("alice", "secret", "example.test", "com.example", "a".repeat(64))
        assertEquals("alice", AutofillPendingStore.take(token)?.username)
        assertEquals(null, AutofillPendingStore.take(token))
    }

    @Test fun `autofill never offers a credential outside its saved scope`() {
        val website = PasswordItem(title = "Example", password = "secret", url = "https://example.test/login")
        val signature = "a".repeat(64)
        val app = PasswordItem(title = "App", password = "secret", url = "android-app://com.example.app", appSignatureSha256 = signature)
        assertTrue(AutofillScope.matches(website, "login.example.test", "com.browser"))
        assertFalse(AutofillScope.matches(website, "example.test.evil.invalid", "com.browser"))
        assertFalse(AutofillScope.matches(website, "", "com.evil.app"))
        assertTrue(AutofillScope.matches(app, "", "com.example.app", signature))
        assertFalse(AutofillScope.matches(app, "", "com.example.app", "b".repeat(64)))
        assertFalse(AutofillScope.matches(app, "", "com.example.fake", signature))
        assertFalse(AutofillScope.matches(app.copy(appSignatureSha256 = ""), "", "com.example.app", signature))
    }

    @Test fun `autofill search never broadens beyond the verified scope`() {
        val signature = "a".repeat(64)
        val exact = PasswordItem(title = "Shop", username = "alice", password = "one", url = "android-app://com.shop", appSignatureSha256 = signature)
        val found = PasswordItem(title = "Work portal", username = "bob@work.test", password = "two", url = "https://work.test")
        val unrelated = PasswordItem(title = "Bank", username = "carol", password = "three", url = "https://bank.test")
        val values = listOf(exact, found, unrelated)

        assertEquals(listOf(exact), autofillCandidates(values, "", "com.shop", signature, ""))
        assertTrue(autofillCandidates(values, "", "com.shop", signature, "bob@work").isEmpty())
        assertTrue(autofillCandidates(values, "", "com.shop", signature, "missing").isEmpty())
    }

    @Test fun `credential manager respects requested user ids`() {
        val signature = "a".repeat(64)
        val alice = PasswordItem(title = "Alice", username = "alice", password = "one", url = "android-app://com.shop", appSignatureSha256 = signature)
        val bob = PasswordItem(title = "Bob", username = "bob", password = "two", url = "android-app://com.shop", appSignatureSha256 = signature)

        assertEquals(listOf(bob), credentialManagerCandidates(listOf(alice, bob), "com.shop", signature, setOf("bob"), ""))
        assertTrue(credentialManagerCandidates(listOf(alice, bob), "com.shop", signature, setOf("mallory"), "").isEmpty())
    }

    @Test fun `legacy autofill supports username-only and password-only forms`() {
        val item = PasswordItem(title = "Account", username = "alice", password = "secret")
        assertEquals(AutofillValuePlan("alice", null), autofillValuePlan(true, false, item))
        assertEquals(AutofillValuePlan(null, "secret"), autofillValuePlan(false, true, item))
        assertEquals(AutofillValuePlan("alice", "secret"), autofillValuePlan(true, true, item))
    }

    @Test fun `main ui must relock when another component closed the shared repository`() {
        assertTrue(needsMainUiRelock(Gate.Open, hasDecryptedSnapshot = true, repositoryOpen = false))
        assertTrue(needsMainUiRelock(Gate.Master, hasDecryptedSnapshot = true, repositoryOpen = false))
        assertFalse(needsMainUiRelock(Gate.Master, hasDecryptedSnapshot = false, repositoryOpen = false))
    }

    @Test fun `protected provisioning temporarily defers idle lock`() {
        assertTrue(protectedProvisioningKeepsSession(active = true, deadlineElapsed = 10_000, nowElapsed = 9_999))
        assertFalse(protectedProvisioningKeepsSession(active = true, deadlineElapsed = 10_000, nowElapsed = 10_000))
        assertFalse(protectedProvisioningKeepsSession(active = false, deadlineElapsed = 10_000, nowElapsed = 1))
    }

    @Test fun `protected space errors are translated for the user`() {
        assertEquals("Это пространство ещё не связано с личным Nocturne. Завершите создание или выполните переподключение.", protectedSpaceFailureMessage("PROFILE_NOT_PAIRED"))
        assertFalse(protectedSpaceFailureMessage("SESSION_EXPIRING")!!.contains('_'))
        assertFalse(protectedSpaceFailureMessage("UNKNOWN_INTERNAL_CODE")!!.contains("UNKNOWN_INTERNAL_CODE"))
    }

    @Test fun `authentication delay uses monotonic time and restarts after reboot`() {
        assertEquals(5, remainingLockoutSeconds(10_000, 5_000, 10_000))
        assertEquals(3, remainingLockoutSeconds(10_000, 5_000, 12_500))
        assertEquals(0, remainingLockoutSeconds(10_000, 5_000, 15_001))
        assertEquals(5, remainingLockoutSeconds(10_000, 5_000, 1_000))
    }

}
