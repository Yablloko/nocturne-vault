package com.nocturne.vault

import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.Assume.assumeFalse
import java.io.File
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.nio.ByteBuffer
import java.util.Base64
import android.graphics.Bitmap
import com.google.zxing.BarcodeFormat
import com.google.zxing.MultiFormatWriter
import org.json.JSONObject

class VaultRepositoryTest {
    private val context = ApplicationProvider.getApplicationContext<android.content.Context>()
    private val pepper: DevicePepper = AndroidDevicePepper()

    @Before fun clean() {
        File(context.filesDir, "vault").deleteRecursively()
        context.filesDir.listFiles()
            ?.filter { it.name.startsWith("vault-import-") || it.name.startsWith("vault-previous-") }
            ?.forEach(File::deleteRecursively)
        context.getSharedPreferences("nocturne_security", 0).edit().clear().commit()
        context.getSharedPreferences("nocturne_private_ui", 0).edit().clear().commit()
    }
    @After fun finish() = clean()

    @Test fun quickPinSurvivesRepositoryRecreation() {
        val master = "Master!Vault2026аб"
        val first = VaultRepository(context, pepper)
        first.create(master.toCharArray())
        first.savePassword(PasswordItem(title = "Почта", password = "secret-marker"))
        first.configureQuick(QuickMode.PIN, "629104".toCharArray(), master.toCharArray())
        first.lock()

        val raw = File(context.filesDir, "vault/vault.nvlt").readText()
        assertFalse(raw.contains("secret-marker"))
        val restarted = VaultRepository(context, pepper)
        assertEquals(Gate.Quick(QuickMode.PIN), restarted.initialGate())
        assertTrue(restarted.unlockQuick(QuickMode.PIN, "629104".toCharArray()).unlocked)
        assertEquals("Почта", restarted.snapshot().passwords.single().title)
    }

    @Test fun encryptedBackupRoundTripRestoresLiveTrashFilesAndSettingsButNotQuickUnlock() {
        val master = "Backup!Vault2026Secure"
        val source = VaultRepository(context, pepper)
        source.create(master.toCharArray())
        val folder = VaultFolder(name = "Работа", kind = "password")
        source.saveFolder(folder)
        source.savePassword(PasswordItem(title = "Почта", username = "alice", password = "secret-password-marker", folderId = folder.id))
        source.saveNote(NoteItem(title = "Планы", body = "private-note-marker"))
        source.saveOtp(OtpItem(issuer = "Nocturne", account = "alice", secret = "JBSWY3DPEHPK3PXP"))
        val liveBytes = "live-file-marker".toByteArray()
        val live = source.importFile("live.txt", "text/plain", liveBytes.copyOf())
        val deletedBytes = "deleted-file-marker".toByteArray()
        val deleted = source.importFile("deleted.txt", "text/plain", deletedBytes.copyOf())
        source.deleteFile(deleted.id)
        source.updateSettings(source.snapshot().settings.copy(autoLockSeconds = 60, clipboardClearSeconds = 5))
        source.configureQuick(QuickMode.PIN, "629104".toCharArray(), master.toCharArray())

        val output = ByteArrayOutputStream()
        source.exportVault(output)
        val backup = output.toByteArray()
        val raw = String(backup, Charsets.ISO_8859_1)
        assertFalse(raw.contains("secret-password-marker"))
        assertFalse(raw.contains("private-note-marker"))
        assertFalse(raw.contains("live-file-marker"))

        source.resetVault()
        val restored = VaultRepository(context, pepper)
        restored.importVault(ByteArrayInputStream(backup), master.toCharArray())

        assertEquals("Почта", restored.snapshot().passwords.single().title)
        assertEquals("Планы", restored.snapshot().notes.single().title)
        assertEquals("Nocturne", restored.snapshot().otp.single().issuer)
        assertArrayEquals(liveBytes, restored.readFile(live.id))
        assertArrayEquals(deletedBytes, restored.readFile(deleted.id))
        assertEquals(60, restored.snapshot().settings.autoLockSeconds)
        assertEquals(QuickMode.NONE, restored.quickMode())
        restored.lock()
        assertEquals(Gate.Master, restored.initialGate())
    }

    @Test fun encryptedBackupRestoresControllerIdentityButInPlaceImportKeepsLocalPairing() {
        val backupPassword = "Portable!Backup2026"
        val source = VaultRepository(context, pepper)
        source.create(backupPassword.toCharArray())
        val exportedIdentity = source.ensureProtectedSpaceIdentity()
        val output = ByteArrayOutputStream()
        source.exportVault(output)

        val input = DataInputStream(ByteArrayInputStream(output.toByteArray()))
        ByteArray(8).also(input::readFully)
        input.readInt()
        val envelope = JSONObject(String(ByteArray(input.readInt()).also(input::readFully), Charsets.UTF_8))
        val decoder = Base64.getDecoder()
        val kdf = envelope.getJSONObject("kdf")
        val masterKey = CryptoBox.derive(backupPassword.toCharArray(), decoder.decode(kdf.getString("salt")), kdf.getInt("iterations"))
        val wrap = envelope.getJSONObject("masterWrap").let { CipherBlob(decoder.decode(it.getString("iv")), decoder.decode(it.getString("ciphertext"))) }
        val vaultKey = CryptoBox.decrypt(masterKey, wrap, "android-master-wrap-v1")
        val payload = envelope.getJSONObject("payload").let { CipherBlob(decoder.decode(it.getString("iv")), decoder.decode(it.getString("ciphertext"))) }
        val exportedData = VaultData.fromJson(JSONObject(String(CryptoBox.decrypt(vaultKey, payload, "android-vault-payload-v1"), Charsets.UTF_8)))
        assertEquals(exportedIdentity.publicKey, exportedData.protectedSpace?.publicKey)
        assertEquals(exportedIdentity.privateKey, exportedData.protectedSpace?.privateKey)
        masterKey.fill(0)
        vaultKey.fill(0)

        source.resetVault()
        val restored = VaultRepository(context, pepper)
        restored.importVault(ByteArrayInputStream(output.toByteArray()), backupPassword.toCharArray())
        assertEquals(exportedIdentity.publicKey, restored.snapshot().protectedSpace?.publicKey)
        assertEquals(exportedIdentity.privateKey, restored.snapshot().protectedSpace?.privateKey)

        restored.resetVault()
        val current = VaultRepository(context, pepper)
        current.create("Current!Vault2026".toCharArray())
        val currentIdentity = current.ensureProtectedSpaceIdentity()
        current.importVault(ByteArrayInputStream(output.toByteArray()), backupPassword.toCharArray())
        assertEquals(currentIdentity.publicKey, current.snapshot().protectedSpace?.publicKey)
        assertEquals(currentIdentity.privateKey, current.snapshot().protectedSpace?.privateKey)
        assertFalse(current.snapshot().protectedSpace?.publicKey == exportedIdentity.publicKey)
    }

    @Test fun wrongBackupPasswordLeavesCurrentVaultUntouched() {
        val backupPassword = "Original!Backup2026"
        val original = VaultRepository(context, pepper)
        original.create(backupPassword.toCharArray())
        original.saveNote(NoteItem(title = "Из копии", body = "original"))
        val output = ByteArrayOutputStream()
        original.exportVault(output)
        original.resetVault()

        val current = VaultRepository(context, pepper)
        current.create("Current!Vault2026Secure".toCharArray())
        current.saveNote(NoteItem(title = "Текущее", body = "must survive"))
        val error = assertThrows(VaultBackupException::class.java) {
            current.importVault(ByteArrayInputStream(output.toByteArray()), "Wrong!Backup2026".toCharArray())
        }

        assertEquals("WRONG_BACKUP_PASSWORD", error.code)
        assertEquals("Текущее", current.snapshot().notes.single().title)
        assertTrue(File(context.filesDir, "vault/vault.nvlt").isFile)
    }

    @Test fun tamperedBackupLeavesCurrentVaultUntouchedAndCleansStaging() {
        val backupPassword = "Original!Backup2026"
        val original = VaultRepository(context, pepper)
        original.create(backupPassword.toCharArray())
        original.importFile("secret.txt", "text/plain", "tamper target".toByteArray())
        val output = ByteArrayOutputStream()
        original.exportVault(output)
        val tampered = output.toByteArray().also { it[it.lastIndex] = (it.last().toInt() xor 1).toByte() }
        original.resetVault()

        val current = VaultRepository(context, pepper)
        current.create("Current!Vault2026Secure".toCharArray())
        current.savePassword(PasswordItem(title = "Остаётся", password = "safe"))
        assertThrows(Exception::class.java) {
            current.importVault(ByteArrayInputStream(tampered), backupPassword.toCharArray())
        }

        assertEquals("Остаётся", current.snapshot().passwords.single().title)
        assertTrue(context.filesDir.listFiles()?.none { it.name.startsWith("vault-import-") } == true)
    }

    @Test fun interruptedImportSwapRestoresPreviousCompleteVaultOnStartup() {
        val master = "Recovery!Vault2026Secure"
        val repository = VaultRepository(context, pepper)
        repository.create(master.toCharArray())
        repository.saveNote(NoteItem(title = "Восстановить", body = "survives interrupted rename"))
        repository.lock()

        val root = File(context.filesDir, "vault")
        val previous = File(context.filesDir, "vault-previous-test")
        assertTrue(root.renameTo(previous))
        assertTrue(root.mkdirs()) // Simulates the empty directory created by the old startup path.

        val recovered = VaultRepository(context, pepper)
        assertEquals(Gate.Master, recovered.initialGate())
        assertTrue(recovered.unlockMaster(master.toCharArray()).unlocked)
        assertEquals("Восстановить", recovered.snapshot().notes.single().title)
        assertFalse(previous.exists())
    }

    @Test fun backupRejectsBlobLengthThatDisagreesWithAuthenticatedMetadata() {
        val master = "Sized!Vault2026Secure"
        val source = VaultRepository(context, pepper)
        source.create(master.toCharArray())
        source.importFile("one.bin", "application/octet-stream", "payload".toByteArray())
        val output = ByteArrayOutputStream().also(source::exportVault).toByteArray()
        val envelopeSize = ByteBuffer.wrap(output, 12, 4).int
        val countOffset = 16 + envelopeSize
        assertEquals(1, ByteBuffer.wrap(output, countOffset, 4).int)
        val idLength = ByteBuffer.wrap(output, countOffset + 4, 4).int
        val sizeOffset = countOffset + 8 + idLength
        val declared = ByteBuffer.wrap(output, sizeOffset, 8).long
        ByteBuffer.wrap(output, sizeOffset, 8).putLong(declared + 1L)

        source.resetVault()
        val current = VaultRepository(context, pepper)
        current.create("Current!Vault2026Secure".toCharArray())
        current.saveNote(NoteItem(title = "Текущее", body = "must survive"))
        assertThrows(Exception::class.java) { current.importVault(ByteArrayInputStream(output), master.toCharArray()) }
        assertEquals("Текущее", current.snapshot().notes.single().title)
    }

    @Test fun importedMetadataRejectsDuplicateAndUnsafeFileIdentifiers() {
        val duplicate = StoredFile(name = "one.txt", mime = "text/plain", size = 1)
        assertThrows(Exception::class.java) {
            validateImportedVaultData(VaultData(files = mutableListOf(duplicate), deletedFiles = mutableListOf(duplicate.copy(name = "two.txt"))))
        }
        assertThrows(Exception::class.java) {
            validateImportedVaultData(VaultData(files = mutableListOf(StoredFile(id = "../../escape", name = "bad.txt", mime = "text/plain", size = 1))))
        }
    }

    @Test fun masterRecoveryKeepsConfiguredPatternAsDefaultGate() {
        val master = "Second!Vault2026аб"
        val pattern = "0-1-4-7-8"
        val first = VaultRepository(context, pepper)
        first.create(master.toCharArray())
        first.configureQuick(QuickMode.PATTERN, pattern.toCharArray(), master.toCharArray())
        first.lock()

        val restarted = VaultRepository(context, pepper)
        assertEquals(Gate.Quick(QuickMode.PATTERN), restarted.initialGate())
        assertTrue(restarted.unlockMaster(master.toCharArray()).unlocked)
        restarted.lock()

        assertEquals(Gate.Quick(QuickMode.PATTERN), restarted.initialGate())
        assertTrue(restarted.unlockQuick(QuickMode.PATTERN, pattern.toCharArray()).unlocked)
    }

    @Test fun wrongMasterChangeAndSettingsAreHandledSafely() {
        val original = "Original!Vault2026"
        val replacement = "Replacement!Vault2026"
        val repository = VaultRepository(context, pepper)
        repository.create(original.toCharArray())
        assertFalse(repository.verifyMasterPassword("Wrong!Password2026".toCharArray()))
        repository.changeMasterPassword(original.toCharArray(), replacement.toCharArray())
        repository.updateSettings(PrivacySettings(allowScreenshots = true, autoLockSeconds = 60, clipboardClearSeconds = 5, hidePatternTrace = false))
        repository.lock()

        val restarted = VaultRepository(context, pepper)
        assertFalse(restarted.unlockMaster(original.toCharArray()).unlocked)
        assertTrue(restarted.unlockMaster(replacement.toCharArray()).unlocked)
        assertTrue(restarted.snapshot().settings.allowScreenshots)
        assertEquals(60, restarted.snapshot().settings.autoLockSeconds)
        assertFalse(restarted.snapshot().settings.hidePatternTrace)
    }

    @Test fun streamingImportIsEncryptedAndExportedExactly() {
        val repository = VaultRepository(context, pepper)
        repository.create("Streaming!Vault2026".toCharArray())
        val marker = "PLAINTEXT-UNIQUE-MARKER-998877"
        val source = (marker + "|" + "payload-".repeat(80_000)).toByteArray()
        val item = repository.importFile("sample.bin", "application/octet-stream", source.size.toLong(), source.inputStream())
        val blob = File(context.filesDir, "vault/blobs/${item.id}.blob").readBytes()
        assertFalse(String(blob, Charsets.ISO_8859_1).contains(marker))
        val output = java.io.ByteArrayOutputStream()
        repository.exportFile(item.id, output)
        assertArrayEquals(source, output.toByteArray())
    }

    @Test fun resetRemovesVaultAndReturnsToCreation() {
        val repository = VaultRepository(context, pepper)
        repository.create("Resettable!Vault2026".toCharArray())
        repository.saveNote(NoteItem(title = "secret", body = "erase-me"))
        repository.resetVault()
        assertEquals(Gate.Create, repository.initialGate())
        assertFalse(File(context.filesDir, "vault/vault.nvlt").exists())
    }

    @Test fun tamperedFileNeverWritesPlaintextToExportDestination() {
        val repository = VaultRepository(context, pepper)
        repository.create("Tamperproof!Vault2026".toCharArray())
        val source = "sensitive export".repeat(10_000).toByteArray()
        val item = repository.importFile("secret.bin", "application/octet-stream", source.size.toLong(), source.inputStream())
        val blobFile = File(context.filesDir, "vault/blobs/${item.id}.blob")
        val tampered = blobFile.readBytes().also { it[it.lastIndex - 3] = (it[it.lastIndex - 3].toInt() xor 1).toByte() }
        blobFile.writeBytes(tampered)
        val destination = java.io.ByteArrayOutputStream()

        assertThrows(Exception::class.java) { repository.exportFile(item.id, destination) }
        assertEquals(0, destination.size())
    }

    @Test fun declaredOversizedImportIsRejectedBeforeReading() {
        val repository = VaultRepository(context, pepper)
        repository.create("Bounded!Vault2026".toCharArray())
        var read = false
        val input = object : java.io.InputStream() {
            override fun read(): Int { read = true; return -1 }
        }
        assertThrows(Exception::class.java) {
            repository.importFile("too-large.bin", "application/octet-stream", VaultRepository.MAX_FILE_BYTES.toLong() + 1, input)
        }
        assertFalse(read)
    }

    @Test fun trashIsEncryptedPersistentAndRestorable() {
        val master = "Trash!Vault2026Secure"
        val repository = VaultRepository(context, pepper)
        repository.create(master.toCharArray())
        val password = PasswordItem(title = "Почта", password = "trash-secret")
        repository.savePassword(password)
        val file = repository.importFile("trash.txt", "text/plain", "secret file".toByteArray())
        repository.deletePassword(password.id)
        repository.deleteFile(file.id)
        assertEquals(2, repository.snapshotForUi().trashCount)
        assertTrue(File(context.filesDir, "vault/blobs/${file.id}.blob").exists())
        repository.lock()

        val restarted = VaultRepository(context, pepper)
        assertTrue(restarted.unlockMaster(master.toCharArray()).unlocked)
        assertEquals(2, restarted.snapshot().trashCount)
        restarted.restoreTrash("password", password.id)
        assertEquals("Почта", restarted.snapshot().passwords.single().title)
        restarted.purgeTrash("file", file.id)
        assertFalse(File(context.filesDir, "vault/blobs/${file.id}.blob").exists())
    }

    @Test fun uiSnapshotDoesNotAliasMutableRepositoryState() {
        val repository = VaultRepository(context, pepper)
        repository.create("Snapshot!Vault2026".toCharArray())
        val first = repository.snapshotForUi()
        repository.saveNote(NoteItem(title = "Новая", body = "заметка"))
        assertTrue(first.notes.isEmpty())
        assertEquals(1, repository.snapshotForUi().notes.size)
    }

    @Test fun textFileCanBeEditedWithoutLeavingPlaintextInBlob() {
        val repository = VaultRepository(context, pepper)
        repository.create("Edit!Vault2026Secure".toCharArray())
        val item = repository.importFile("note.txt", "text/plain", "old".toByteArray())
        repository.replaceTextFile(item.id, "new private text")
        assertEquals("new private text", repository.readFile(item.id).toString(Charsets.UTF_8))
        assertFalse(File(context.filesDir, "vault/blobs/${item.id}.blob").readText(Charsets.ISO_8859_1).contains("new private text"))
    }

    @Test fun otpQrAndUriImportAreParsed() {
        val uri = "otpauth://totp/Example:alice%40mail.test?secret=JBSWY3DPEHPK3PXP&issuer=Example"
        val matrix = MultiFormatWriter().encode(uri, BarcodeFormat.QR_CODE, 500, 500)
        val bitmap = Bitmap.createBitmap(500, 500, Bitmap.Config.ARGB_8888)
        for (y in 0 until 500) for (x in 0 until 500) bitmap.setPixel(x, y, if (matrix[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE)
        val item = decodeOtpQr(bitmap)
        assertEquals("Example", item.issuer)
        assertEquals("alice@mail.test", item.account)
        assertEquals("JBSWY3DPEHPK3PXP", item.secret)
    }

    @Test fun folderRenamePersistsAndDeletionMovesWholeTreeToTrash() {
        val master = "Folders!Vault2026Secure"
        val repository = VaultRepository(context, pepper)
        repository.create(master.toCharArray())
        val folder = VaultFolder(name = "Работа", kind = "password")
        val child = VaultFolder(name = "Почта", kind = "password", parentId = folder.id)
        repository.saveFolder(folder)
        repository.saveFolder(child)
        repository.savePassword(PasswordItem(title = "Рабочий пароль", password = "secret", folderId = folder.id))
        repository.savePassword(PasswordItem(title = "Почта", password = "secret", folderId = child.id))
        assertThrows(Exception::class.java) { repository.saveNote(NoteItem(title = "Неверная папка", folderId = folder.id)) }
        repository.saveFolder(folder.copy(name = "Рабочее"))
        assertEquals("Рабочее", repository.snapshot().folders.first { it.id == folder.id }.name)
        repository.deleteFolder(folder.id)
        assertTrue(repository.snapshot().folders.none { it.id == folder.id || it.id == child.id })
        assertTrue(repository.snapshot().passwords.isEmpty())
        assertEquals(setOf("Рабочий пароль", "Почта"), repository.snapshot().deletedPasswords.map { it.title }.toSet())
        assertTrue(repository.snapshot().deletedPasswords.all { it.folderId.isBlank() })
        val noteFolder = VaultFolder(name = "Идеи", kind = "note")
        repository.saveFolder(noteFolder)
        repository.saveNote(NoteItem(title = "Черновик", folderId = noteFolder.id))
        repository.deleteFolder(noteFolder.id)
        assertTrue(repository.snapshot().notes.isEmpty())
        assertEquals("Черновик", repository.snapshot().deletedNotes.single().title)
        assertEquals("", repository.snapshot().deletedNotes.single().folderId)
        val fileFolder = VaultFolder(name = "Документы", kind = "file")
        repository.saveFolder(fileFolder)
        repository.importFile("plan.txt", "text/plain", "plan".toByteArray(), folderId = fileFolder.id)
        repository.deleteFolder(fileFolder.id)
        assertTrue(repository.snapshot().files.none { it.name == "plan.txt" })
        assertEquals("", repository.snapshot().deletedFiles.single { it.name == "plan.txt" }.folderId)
        repository.lock()

        val reopened = VaultRepository(context, pepper)
        assertTrue(reopened.unlockMaster(master.toCharArray()).unlocked)
        assertTrue(reopened.snapshot().folders.isEmpty())
        assertEquals(setOf("Рабочий пароль", "Почта"), reopened.snapshot().deletedPasswords.map { it.title }.toSet())
        assertEquals("Черновик", reopened.snapshot().deletedNotes.single().title)
        assertEquals("plan.txt", reopened.snapshot().deletedFiles.single().name)
    }

    @Test fun deletingSeveralFoldersMovesEveryDescendantItemToTrash() {
        val repository = VaultRepository(context, pepper)
        repository.create("BatchFolders!Vault2026".toCharArray())
        val parent = VaultFolder(name = "Родитель", kind = "password")
        val child = VaultFolder(name = "Дочерняя", kind = "password", parentId = parent.id)
        val survivor = VaultFolder(name = "Оставшаяся", kind = "password", parentId = child.id)
        repository.saveFolder(parent)
        repository.saveFolder(child)
        repository.saveFolder(survivor)
        repository.savePassword(PasswordItem(title = "Из родителя", password = "one", folderId = parent.id))
        repository.savePassword(PasswordItem(title = "Из дочерней", password = "two", folderId = child.id))
        repository.savePassword(PasswordItem(title = "В оставшейся", password = "three", folderId = survivor.id))

        repository.deleteFolders(setOf(parent.id, child.id))

        assertTrue(repository.snapshot().folders.isEmpty())
        assertTrue(repository.snapshot().passwords.isEmpty())
        assertEquals(setOf("Из родителя", "Из дочерней", "В оставшейся"), repository.snapshot().deletedPasswords.map { it.title }.toSet())
        assertTrue(repository.snapshot().deletedPasswords.all { it.folderId.isBlank() })
    }

    @Test fun hiddenPatternPreferenceIsAvailableWhileVaultIsLocked() {
        val repository = VaultRepository(context, pepper)
        repository.create("PatternPrivacy!2026".toCharArray())
        repository.updateSettings(repository.snapshot().settings.copy(hidePatternTrace = false))
        repository.lock()
        assertFalse(VaultRepository(context, pepper).hidePatternTrace())
    }

    @Test fun audioAttachmentIsHiddenFromLibraryAndPurgedWithDeletedNote() {
        val repository = VaultRepository(context, pepper)
        repository.create("Audio!Vault2026Secure".toCharArray())
        val audio = repository.importFile("voice.m4a", "audio/mp4", "voice-secret".toByteArray(), purpose = StoredFile.PURPOSE_NOTE_AUDIO)
        val note = NoteItem(title = "Голос", audioFileId = audio.id, audioDurationMs = 2_000)
        repository.saveNote(note)
        assertEquals(StoredFile.PURPOSE_NOTE_AUDIO, repository.snapshot().files.single().purpose)
        repository.deleteNote(note.id)
        assertTrue(File(context.filesDir, "vault/blobs/${audio.id}.blob").exists())
        repository.purgeTrash("note", note.id)
        assertFalse(File(context.filesDir, "vault/blobs/${audio.id}.blob").exists())
        assertTrue(repository.snapshot().files.none { it.id == audio.id })
    }

    @Test fun deletedFilesRemainPreviewableUntilPermanentPurge() {
        val repository = VaultRepository(context, pepper)
        repository.create("PreviewTrash!2026Secure".toCharArray())
        val source = "deleted-preview".toByteArray()
        val file = repository.importFile("preview.txt", "text/plain", source.copyOf())
        repository.deleteFile(file.id)
        assertArrayEquals(source, repository.readFile(file.id))
        repository.purgeTrash("file", file.id)
        assertThrows(Exception::class.java) { repository.readFile(file.id) }
    }

    @Test fun vaultDataRoundTripKeepsFoldersAndHiddenAttachmentMetadata() {
        val folder = VaultFolder(name = "Личное", kind = "note")
        val audio = StoredFile(name = "voice.m4a", mime = "audio/mp4", size = 42, purpose = StoredFile.PURPOSE_NOTE_AUDIO)
        val original = VaultData(
            notes = mutableListOf(NoteItem(title = "Голос", folderId = folder.id, audioFileId = audio.id, audioDurationMs = 4_200)),
            files = mutableListOf(audio),
            folders = mutableListOf(folder),
        )
        val restored = VaultData.fromJson(original.toJson())
        assertEquals(folder.id, restored.notes.single().folderId)
        assertEquals(audio.id, restored.notes.single().audioFileId)
        assertEquals(StoredFile.PURPOSE_NOTE_AUDIO, restored.files.single().purpose)
    }

    @Test fun personalVaultKeyIsClearedAtScreenOffBoundary() {
        assumeFalse(ProtectedSpaceManager.isProfileOwner(context))
        val application = context.applicationContext as NocturneApplication
        application.repository.resetVault()
        application.repository.create("ScreenOff!Vault2026Secure".toCharArray())
        assertTrue(application.repository.isOpen())
        application.lockForScreenOff(context)
        assertFalse(application.repository.isOpen())
    }
}
