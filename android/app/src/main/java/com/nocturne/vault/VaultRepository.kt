package com.nocturne.vault

import android.annotation.SuppressLint
import android.content.Context
import android.os.SystemClock
import android.util.AtomicFile
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import java.util.Base64
import java.util.UUID
import javax.crypto.Cipher

internal fun moveFolderTreesToTrash(value: VaultData, ids: Set<String>) {
    val removed = value.folders.filter { it.id in ids }.mapTo(mutableSetOf()) { it.id }
    if (removed.isEmpty()) return
    var expanded: Boolean
    do {
        val before = removed.size
        value.folders.filter { it.parentId in removed }.mapTo(removed) { it.id }
        expanded = removed.size != before
    } while (expanded)

    value.passwords.filter { it.folderId in removed }.forEach { value.deletedPasswords.add(0, it.copy(folderId = "")) }
    value.notes.filter { it.folderId in removed }.forEach { value.deletedNotes.add(0, it.copy(folderId = "")) }
    value.files.filter { it.folderId in removed && it.purpose == StoredFile.PURPOSE_LIBRARY }
        .forEach { value.deletedFiles.add(0, it.copy(folderId = "")) }

    value.passwords.removeAll { it.folderId in removed }
    value.notes.removeAll { it.folderId in removed }
    value.files.removeAll { it.folderId in removed && it.purpose == StoredFile.PURPOSE_LIBRARY }
    value.folders.removeAll { it.id in removed }
}

class VaultRepository(
    context: Context,
    private val pepper: DevicePepper = AndroidDevicePepper(),
) {
    private val expectedRoot = recoverInterruptedVaultRoot(context.filesDir.canonicalFile)
    private val root = expectedRoot.apply { mkdirs() }
    private val envelopeFile = AtomicFile(File(root, "vault.nvlt"))
    private val blobDir = File(root, "blobs").apply { mkdirs() }
    private val security = context.getSharedPreferences("nocturne_security", Context.MODE_PRIVATE)
    private val uiPreferences = context.getSharedPreferences("nocturne_private_ui", Context.MODE_PRIVATE)
    private var envelope: JSONObject? = null
    private var vaultKey: ByteArray? = null
    private var data: VaultData? = null

    fun initialGate(): Gate {
        if (!envelopeFile.baseFile.exists()) return Gate.Create
        val current = readEnvelope()
        val mode = runCatching { QuickMode.valueOf(current.optJSONObject("quick")?.optString("mode") ?: "NONE") }.getOrDefault(QuickMode.NONE)
        return if (mode == QuickMode.NONE) Gate.Master else Gate.Quick(mode)
    }

    fun isOpen() = vaultKey != null && data != null
    fun snapshot(): VaultData = data ?: error("VAULT_LOCKED")
    @Synchronized fun snapshotForUi(): VaultData = snapshot().copyForUi()

    fun quickMode(): QuickMode {
        if (!envelopeFile.baseFile.exists()) return QuickMode.NONE
        return runCatching {
            QuickMode.valueOf(readEnvelope().optJSONObject("quick")?.optString("mode") ?: "NONE")
        }.getOrDefault(QuickMode.NONE)
    }

    fun systemQuickIv(): ByteArray {
        val quick = readEnvelope().optJSONObject("quick") ?: error("QUICK_UNLOCK_UNAVAILABLE")
        require(quick.getString("mode") == QuickMode.SYSTEM.name)
        return unb64(quick.getString("iv"))
    }

    fun create(masterPassword: CharArray) {
        require(SecurityPolicy.isStrongMaster(masterPassword)) { "WEAK_MASTER_PASSWORD" }
        check(!envelopeFile.baseFile.exists()) { "VAULT_EXISTS" }
        root.mkdirs()
        blobDir.mkdirs()
        val key = CryptoBox.randomBytes(32)
        val salt = CryptoBox.randomBytes(16)
        val masterKey = CryptoBox.derive(masterPassword, salt, CryptoBox.MASTER_ITERATIONS)
        try {
            val wrap = CryptoBox.encrypt(masterKey, key, "android-master-wrap-v1")
            envelope = JSONObject()
                .put("version", 1)
                .put("kdf", JSONObject().put("salt", b64(salt)).put("iterations", CryptoBox.MASTER_ITERATIONS))
                .put("masterWrap", blobJson(wrap))
                .put("quick", JSONObject.NULL)
            vaultKey = key
            data = VaultData()
            persist()
            clearFailures()
        } finally {
            masterKey.fill(0)
            masterPassword.fill('\u0000')
        }
    }

    fun unlockMaster(password: CharArray): UnlockResult = authenticate {
        val current = readEnvelope()
        val kdf = current.getJSONObject("kdf")
        val iterations = kdf.getInt("iterations").also { require(it in 100_000..2_000_000) { "INVALID_KDF" } }
        val candidate = CryptoBox.derive(password, unb64(kdf.getString("salt")), iterations)
        try { CryptoBox.decrypt(candidate, parseBlob(current.getJSONObject("masterWrap")), "android-master-wrap-v1") }
        finally { candidate.fill(0); password.fill('\u0000') }
    }

    fun unlockQuick(mode: QuickMode, credential: CharArray): UnlockResult = authenticate {
        require(mode != QuickMode.NONE && mode != QuickMode.SYSTEM)
        val quick = readEnvelope().optJSONObject("quick") ?: error("QUICK_UNLOCK_UNAVAILABLE")
        require(quick.getString("mode") == mode.name) { "QUICK_MODE_MISMATCH" }
        validateQuick(mode, credential)
        val salt = unb64(quick.getString("salt"))
        val iterations = quick.getInt("iterations").also { require(it in 100_000..1_000_000) { "INVALID_KDF" } }
        val derived = CryptoBox.derive(credential, salt, iterations)
        val mixed = try { pepper.mix(derived) } finally { derived.fill(0); credential.fill('\u0000') }
        try { CryptoBox.decrypt(mixed, parseBlob(quick.getJSONObject("wrap")), "android-quick-wrap-v1:${mode.name}") }
        finally { mixed.fill(0) }
    }

    fun unlockSystem(cipher: Cipher): UnlockResult = authenticate {
        val quick = readEnvelope().optJSONObject("quick") ?: error("QUICK_UNLOCK_UNAVAILABLE")
        require(quick.getString("mode") == QuickMode.SYSTEM.name) { "QUICK_MODE_MISMATCH" }
        cipher.doFinal(unb64(quick.getString("ciphertext")))
    }

    private fun authenticate(unwrapper: () -> ByteArray): UnlockResult {
        val wait = retryAfterSeconds()
        if (wait > 0) return UnlockResult(false, wait)
        val key = try { unwrapper() } catch (_: Exception) { recordFailure(); return UnlockResult(false, retryAfterSeconds()) }
        return try {
            val current = readEnvelope()
            val plain = CryptoBox.decrypt(key, parseBlob(current.getJSONObject("payload")), "android-vault-payload-v1")
            try { data = VaultData.fromJson(JSONObject(String(plain, Charsets.UTF_8))) } finally { plain.fill(0) }
            envelope = current
            vaultKey?.takeUnless { it === key }?.fill(0)
            vaultKey = key
            clearFailures()
            UnlockResult(true)
        } catch (_: Exception) {
            key.fill(0)
            recordFailure()
            UnlockResult(false, retryAfterSeconds())
        }
    }

    fun configureQuick(mode: QuickMode, credential: CharArray, masterPassword: CharArray) {
        check(isOpen()) { "VAULT_LOCKED" }
        require(mode != QuickMode.SYSTEM) { "USE_SYSTEM_QUICK_CONFIGURATOR" }
        val current = envelope ?: readEnvelope()
        requireMaster(current, masterPassword)

        if (mode == QuickMode.NONE) {
            credential.fill('\u0000')
            current.put("quick", JSONObject.NULL)
        } else {
            validateQuick(mode, credential)
            val salt = CryptoBox.randomBytes(16)
            val derived = CryptoBox.derive(credential, salt, CryptoBox.QUICK_ITERATIONS)
            val mixed = try { pepper.mix(derived) } finally { derived.fill(0); credential.fill('\u0000') }
            try {
                current.put("quick", JSONObject()
                    .put("mode", mode.name)
                    .put("salt", b64(salt))
                    .put("iterations", CryptoBox.QUICK_ITERATIONS)
                    .put("wrap", blobJson(CryptoBox.encrypt(mixed, vaultKey!!, "android-quick-wrap-v1:${mode.name}"))))
            } finally { mixed.fill(0) }
        }
        envelope = current
        persist()
    }

    fun configureSystemQuick(cipher: Cipher, masterPassword: CharArray) {
        check(isOpen()) { "VAULT_LOCKED" }
        val current = envelope ?: readEnvelope()
        requireMaster(current, masterPassword)
        val ciphertext = cipher.doFinal(vaultKey ?: error("VAULT_LOCKED"))
        current.put("quick", JSONObject()
            .put("mode", QuickMode.SYSTEM.name)
            .put("iv", b64(cipher.iv))
            .put("ciphertext", b64(ciphertext)))
        envelope = current
        persist()
    }

    fun verifyMasterPassword(password: CharArray): Boolean {
        check(isOpen()) { "VAULT_LOCKED" }
        return runCatching { requireMaster(envelope ?: readEnvelope(), password); true }.getOrElse { false }
    }

    @Synchronized
    fun ensureProtectedSpaceIdentity(): ProtectedSpaceIdentity {
        snapshot().protectedSpace?.let { return it.copy() }
        val created = ProtectedSpaceProtocol.createIdentity()
        mutate { it.protectedSpace = created }
        return created.copy()
    }

    @Synchronized
    fun createProtectedSpaceCommand(action: String, packageName: String = ""): ProtectedSpaceCommand {
        val current = snapshot().protectedSpace ?: ProtectedSpaceProtocol.createIdentity()
        val (updated, command) = ProtectedSpaceProtocol.sign(current, action, packageName)
        mutate { it.protectedSpace = updated }
        return command
    }

    fun createProtectedSpaceRepairCommand(): ProtectedSpaceCommand {
        val current = snapshot().protectedSpace ?: ProtectedSpaceProtocol.createIdentity()
        val (updated, command) = ProtectedSpaceProtocol.sign(
            current,
            ProtectedSpaceProtocol.ACTION_REPAIR,
        )
        mutate { it.protectedSpace = updated }
        return command
    }

    fun changeMasterPassword(currentPassword: CharArray, newPassword: CharArray) {
        check(isOpen()) { "VAULT_LOCKED" }
        require(SecurityPolicy.isStrongMaster(newPassword)) { "WEAK_MASTER_PASSWORD" }
        val current = envelope ?: readEnvelope()
        requireMaster(current, currentPassword)
        val newSalt = CryptoBox.randomBytes(16)
        val newMasterKey = CryptoBox.derive(newPassword, newSalt, CryptoBox.MASTER_ITERATIONS)
        try {
            current.put("kdf", JSONObject().put("salt", b64(newSalt)).put("iterations", CryptoBox.MASTER_ITERATIONS))
            current.put("masterWrap", blobJson(CryptoBox.encrypt(newMasterKey, vaultKey!!, "android-master-wrap-v1")))
            envelope = current
            persist()
        } finally {
            newMasterKey.fill(0)
            newPassword.fill('\u0000')
        }
    }

    @SuppressLint("ApplySharedPref", "UseKtx")
    fun updateSettings(settings: PrivacySettings) {
        mutate { it.settings = settings }
        uiPreferences.edit().putBoolean(PREF_HIDE_PATTERN_TRACE, settings.hidePatternTrace).commit()
    }

    fun hidePatternTrace(): Boolean = uiPreferences.getBoolean(PREF_HIDE_PATTERN_TRACE, true)

    fun savePassword(item: PasswordItem) = mutate { value -> validateFolder(item.folderId, "password", value); value.passwords.removeAll { old -> old.id == item.id }; value.passwords.add(0, item) }
    fun deletePassword(id: String) = mutate { value -> value.passwords.firstOrNull { it.id == id }?.let(value.deletedPasswords::add); value.passwords.removeAll { it.id == id } }
    fun saveNote(item: NoteItem) {
        var replacedAudio = ""
        mutate { value ->
            validateFolder(item.folderId, "note", value)
            replacedAudio = value.notes.firstOrNull { it.id == item.id }?.audioFileId.orEmpty().takeIf { it != item.audioFileId }.orEmpty()
            value.notes.removeAll { it.id == item.id }
            value.notes.add(0, item)
            if (replacedAudio.isNotBlank()) value.files.removeAll { it.id == replacedAudio && it.purpose == StoredFile.PURPOSE_NOTE_AUDIO }
        }
        if (replacedAudio.isNotBlank()) File(blobDir, "$replacedAudio.blob").delete()
    }
    fun deleteNote(id: String) = mutate { value -> value.notes.firstOrNull { it.id == id }?.let(value.deletedNotes::add); value.notes.removeAll { it.id == id } }
    fun saveOtp(item: OtpItem) = mutate { it.otp.removeAll { old -> old.id == item.id }; it.otp.add(0, item) }
    fun deleteOtp(id: String) = mutate { value -> value.otp.firstOrNull { it.id == id }?.let(value.deletedOtp::add); value.otp.removeAll { it.id == id } }

    @Synchronized
    fun importFile(name: String, mime: String, bytes: ByteArray, folderId: String = "", purpose: String = StoredFile.PURPOSE_LIBRARY): StoredFile {
        check(bytes.size <= MAX_FILE_BYTES) { "FILE_TOO_LARGE" }
        validateFolder(folderId, "file")
        val item = StoredFile(name = name.take(180), mime = mime.take(120), size = bytes.size.toLong(), folderId = folderId, purpose = purpose)
        val encrypted = try {
            CryptoBox.encrypt(vaultKey ?: error("VAULT_LOCKED"), bytes, "android-file-v1:${item.id}")
        } finally {
            bytes.fill(0)
        }
        writeBlob(item.id, encrypted)
        try {
            mutate { it.files.add(0, item) }
        } catch (error: Throwable) {
            File(blobDir, "${item.id}.blob").delete()
            throw error
        }
        return item
    }

    @Synchronized
    fun importFile(
        name: String,
        mime: String,
        expectedSize: Long,
        input: InputStream,
        folderId: String = "",
        purpose: String = StoredFile.PURPOSE_LIBRARY,
        onProgress: (Long) -> Unit = {},
    ): StoredFile {
        check(isOpen()) { "VAULT_LOCKED" }
        require(expectedSize <= MAX_FILE_BYTES || expectedSize < 0) { "FILE_TOO_LARGE" }
        validateFolder(folderId, "file")
        val id = java.util.UUID.randomUUID().toString()
        val target = AtomicFile(File(blobDir, "$id.blob"))
        val stream = target.startWrite()
        var actualSize = 0L
        try {
            val data = DataOutputStream(stream)
            data.writeInt(12)
            val result = CryptoBox.encryptStream(vaultKey!!, input, data, "android-file-v1:$id", MAX_FILE_BYTES.toLong(), onProgress)
            require(result.first.size == 12)
            stream.fd.sync()
            target.finishWrite(stream)
            actualSize = result.second
        } catch (error: Throwable) {
            target.failWrite(stream)
            throw error
        }
        val item = StoredFile(id = id, name = name.take(180), mime = mime.take(120), size = actualSize, folderId = folderId, purpose = purpose)
        try {
            mutate { it.files.add(0, item) }
        } catch (error: Throwable) {
            target.baseFile.delete()
            throw error
        }
        return item
    }

    fun readFile(id: String): ByteArray {
        val current = snapshot()
        val item = current.files.firstOrNull { it.id == id } ?: current.deletedFiles.firstOrNull { it.id == id } ?: error("FILE_NOT_FOUND")
        require(item.size <= MAX_IN_MEMORY_READ_BYTES) { "FILE_TOO_LARGE_FOR_MEMORY" }
        return CryptoBox.decrypt(vaultKey ?: error("VAULT_LOCKED"), readBlob(item.id), "android-file-v1:${item.id}")
    }

    fun exportFile(id: String, output: OutputStream) {
        val item = snapshot().files.firstOrNull { it.id == id } ?: error("FILE_NOT_FOUND")
        val source = File(blobDir, "${item.id}.blob")
        val key = vaultKey ?: error("VAULT_LOCKED")
        source.inputStream().buffered().use { input ->
            CryptoBox.decryptStream(key, input, DISCARD_OUTPUT, "android-file-v1:${item.id}")
        }
        source.inputStream().buffered().use { input ->
            CryptoBox.decryptStream(key, input, output, "android-file-v1:${item.id}")
        }
    }

    @Synchronized
    fun exportVault(output: OutputStream) {
        check(isOpen()) { "VAULT_LOCKED" }
        val currentData = snapshot()
        val files = validateImportedVaultData(currentData)
        val sourceEnvelope = envelope ?: readEnvelope()
        // The controller identity is part of the encrypted vault state. Restoring it after an app
        // reset keeps the personal and managed-profile copies paired without a manual code.
        val portableData = currentData.copyForUi()
        val portablePlain = portableData.toJson().toString().toByteArray(Charsets.UTF_8)
        val portablePayload = try { blobJson(CryptoBox.encrypt(vaultKey!!, portablePlain, "android-vault-payload-v1")) }
            finally { portablePlain.fill(0) }
        val portableEnvelope = JSONObject()
            .put("version", sourceEnvelope.getInt("version"))
            .put("kdf", sourceEnvelope.getJSONObject("kdf"))
            .put("masterWrap", sourceEnvelope.getJSONObject("masterWrap"))
            .put("payload", portablePayload)
            .put("quick", JSONObject.NULL)
        val envelopeBytes = portableEnvelope.toString().toByteArray(Charsets.UTF_8)
        try {
            require(envelopeBytes.size in 1..MAX_BACKUP_ENVELOPE_BYTES) { "BACKUP_METADATA_TOO_LARGE" }
            val dataOut = DataOutputStream(BufferedOutputStream(output, BACKUP_BUFFER_BYTES))
            dataOut.write(BACKUP_MAGIC)
            dataOut.writeInt(BACKUP_VERSION)
            dataOut.writeInt(envelopeBytes.size)
            dataOut.write(envelopeBytes)
            dataOut.writeInt(files.size)
            for (item in files.sortedBy { it.id }) {
                val source = checkedBlobFile(blobDir, item.id)
                require(source.isFile && source.length() in MIN_ENCRYPTED_BLOB_BYTES..MAX_ENCRYPTED_BLOB_BYTES) { "BACKUP_BLOB_INVALID" }
                source.inputStream().buffered(BACKUP_BUFFER_BYTES).use { input ->
                    CryptoBox.decryptStream(vaultKey!!, input, DISCARD_OUTPUT, "android-file-v1:${item.id}")
                }
                writeBackupString(dataOut, item.id)
                dataOut.writeLong(source.length())
                source.inputStream().buffered(BACKUP_BUFFER_BYTES).use { it.copyTo(dataOut, BACKUP_BUFFER_BYTES) }
            }
            dataOut.flush()
        } finally {
            envelopeBytes.fill(0)
        }
    }

    @Synchronized
    fun importVault(input: InputStream, masterPassword: CharArray) {
        val currentPairing = data?.protectedSpace?.copy()
        val parent = expectedRoot.parentFile?.canonicalFile ?: error("UNSAFE_IMPORT_PATH")
        val staging = File(parent, "vault-import-${UUID.randomUUID()}").canonicalFile
        val previous = File(parent, "vault-previous-${UUID.randomUUID()}").canonicalFile
        require(staging.parentFile == parent && previous.parentFile == parent) { "UNSAFE_IMPORT_PATH" }
        var importedKey: ByteArray? = null
        var installed = false
        try {
            val dataIn = DataInputStream(BufferedInputStream(input, BACKUP_BUFFER_BYTES))
            val magic = ByteArray(BACKUP_MAGIC.size).also(dataIn::readFully)
            require(MessageDigest.isEqual(magic, BACKUP_MAGIC)) { "INVALID_BACKUP" }
            require(dataIn.readInt() == BACKUP_VERSION) { "UNSUPPORTED_BACKUP_VERSION" }
            val envelopeSize = dataIn.readInt()
            require(envelopeSize in 1..MAX_BACKUP_ENVELOPE_BYTES) { "INVALID_BACKUP" }
            val envelopeBytes = ByteArray(envelopeSize).also(dataIn::readFully)
            val importedEnvelope = try { JSONObject(String(envelopeBytes, Charsets.UTF_8)) } finally { envelopeBytes.fill(0) }
            require(importedEnvelope.getInt("version") == 1) { "UNSUPPORTED_VAULT_VERSION" }
            val kdf = importedEnvelope.getJSONObject("kdf")
            val iterations = kdf.getInt("iterations").also { require(it in 100_000..2_000_000) { "INVALID_KDF" } }
            val salt = unb64(kdf.getString("salt")).also { require(it.size == 16) { "INVALID_KDF" } }
            val masterKey = CryptoBox.derive(masterPassword, salt, iterations)
            salt.fill(0)
            importedKey = try {
                CryptoBox.decrypt(masterKey, parseBlob(importedEnvelope.getJSONObject("masterWrap")), "android-master-wrap-v1")
            } catch (error: Throwable) {
                recordFailure()
                throw VaultBackupException("WRONG_BACKUP_PASSWORD", error)
            } finally {
                masterKey.fill(0)
            }
            require(importedKey.size == 32) { "INVALID_BACKUP_KEY" }
            val plain = CryptoBox.decrypt(importedKey, parseBlob(importedEnvelope.getJSONObject("payload")), "android-vault-payload-v1")
            val importedData = try { VaultData.fromJson(JSONObject(String(plain, Charsets.UTF_8))) } finally { plain.fill(0) }
            // An existing local identity already matches this device's managed profile and wins
            // over the imported one. A fresh install/reset restores the encrypted backup identity.
            if (currentPairing != null) importedData.protectedSpace = currentPairing
            val expectedFiles = validateImportedVaultData(importedData).associateBy { it.id }
            val count = dataIn.readInt()
            require(count == expectedFiles.size && count in 0..MAX_BACKUP_FILES) { "BACKUP_FILE_SET_MISMATCH" }
            val expectedTotal = expectedFiles.values.fold(0L) { total, item ->
                Math.addExact(total, Math.addExact(item.size, ENCRYPTED_BLOB_OVERHEAD_BYTES))
            }
            require(expectedTotal <= MAX_BACKUP_TOTAL_ENCRYPTED_BYTES) { "BACKUP_TOO_LARGE" }
            val freeSpaceReserve = maxOf(MIN_IMPORT_FREE_SPACE_BYTES, parent.totalSpace / 20L)
            require(parent.usableSpace >= Math.addExact(expectedTotal, freeSpaceReserve)) { "BACKUP_NOT_ENOUGH_SPACE" }

            val stagedBlobs = File(staging, "blobs").apply { mkdirs() }.canonicalFile
            require(stagedBlobs.parentFile == staging) { "UNSAFE_IMPORT_PATH" }
            val seen = HashSet<String>(count)
            repeat(count) {
                val id = readBackupString(dataIn)
                require(id in expectedFiles && seen.add(id)) { "BACKUP_FILE_SET_MISMATCH" }
                val encryptedSize = dataIn.readLong()
                require(encryptedSize in MIN_ENCRYPTED_BLOB_BYTES..MAX_ENCRYPTED_BLOB_BYTES) { "BACKUP_BLOB_INVALID" }
                require(encryptedSize == Math.addExact(expectedFiles.getValue(id).size, ENCRYPTED_BLOB_OVERHEAD_BYTES)) { "BACKUP_BLOB_SIZE_MISMATCH" }
                val destination = checkedBlobFile(stagedBlobs, id)
                FileOutputStream(destination).use { target ->
                    copyExactly(dataIn, target, encryptedSize)
                    target.fd.sync()
                }
            }
            require(dataIn.read() == -1 && seen == expectedFiles.keys) { "BACKUP_TRAILING_OR_MISSING_DATA" }
            for (id in seen) {
                checkedBlobFile(stagedBlobs, id).inputStream().buffered(BACKUP_BUFFER_BYTES).use { encrypted ->
                    CryptoBox.decryptStream(importedKey, encrypted, DISCARD_OUTPUT, "android-file-v1:$id")
                }
            }

            val sanitizedPlain = importedData.toJson().toString().toByteArray(Charsets.UTF_8)
            val sanitizedPayload = try { blobJson(CryptoBox.encrypt(importedKey, sanitizedPlain, "android-vault-payload-v1")) }
                finally { sanitizedPlain.fill(0) }
            val normalizedEnvelope = JSONObject()
                .put("version", 1)
                .put("kdf", JSONObject().put("salt", kdf.getString("salt")).put("iterations", iterations))
                .put("masterWrap", importedEnvelope.getJSONObject("masterWrap"))
                .put("payload", sanitizedPayload)
                .put("quick", JSONObject.NULL)
            writeSynced(File(staging, "vault.nvlt"), normalizedEnvelope.toString().toByteArray(Charsets.UTF_8))
            require(expectedRoot.canonicalFile == root && root.parentFile?.canonicalFile == parent) { "UNSAFE_IMPORT_PATH" }
            require(root.renameTo(previous)) { "IMPORT_SWAP_FAILED" }
            if (!staging.renameTo(root)) {
                check(previous.renameTo(root)) { "IMPORT_ROLLBACK_FAILED" }
                error("IMPORT_SWAP_FAILED")
            }
            installed = true
            vaultKey?.fill(0)
            vaultKey = importedKey
            importedKey = null
            envelope = normalizedEnvelope
            data = importedData
            clearFailures()
            uiPreferences.edit().putBoolean(PREF_HIDE_PATTERN_TRACE, importedData.settings.hidePatternTrace).commit()
            runCatching { DeviceCredentialCrypto().delete() }
            runCatching { deleteInternalTree(previous, "vault-previous-") }
        } finally {
            masterPassword.fill('\u0000')
            importedKey?.fill(0)
            if (!installed) deleteInternalTree(staging, "vault-import-")
        }
    }

    fun deleteFile(id: String) {
        mutate { value -> value.files.firstOrNull { it.id == id && it.purpose == StoredFile.PURPOSE_LIBRARY }?.let(value.deletedFiles::add); value.files.removeAll { it.id == id && it.purpose == StoredFile.PURPOSE_LIBRARY } }
    }

    fun deleteFiles(ids: Set<String>) {
        if (ids.isEmpty()) return
        mutate { value ->
            value.files.filter { it.id in ids && it.purpose == StoredFile.PURPOSE_LIBRARY }.forEach(value.deletedFiles::add)
            value.files.removeAll { it.id in ids && it.purpose == StoredFile.PURPOSE_LIBRARY }
        }
    }

    fun saveFolder(folder: VaultFolder) = mutate { value ->
        require(folder.kind in setOf("password", "note", "file")) { "INVALID_FOLDER_KIND" }
        require(folder.name.trim().isNotEmpty()) { "INVALID_FOLDER_NAME" }
        require(folder.name.length <= 80) { "INVALID_FOLDER_NAME" }
        if (folder.parentId.isNotBlank()) require(value.folders.any { it.id == folder.parentId && it.kind == folder.kind }) { "INVALID_PARENT_FOLDER" }
        require(folder.parentId != folder.id) { "INVALID_PARENT_FOLDER" }
        value.folders.removeAll { it.id == folder.id }
        value.folders.add(folder.copy(name = folder.name.trim()))
    }

    fun deleteFolder(id: String) = deleteFolders(setOf(id))

    fun deleteFolders(ids: Set<String>) = mutate { value -> moveFolderTreesToTrash(value, ids) }

    fun moveFile(id: String, folderId: String) = mutate { value ->
        validateFolder(folderId, "file", value)
        val index = value.files.indexOfFirst { it.id == id && it.purpose == StoredFile.PURPOSE_LIBRARY }
        require(index >= 0) { "FILE_NOT_FOUND" }
        value.files[index] = value.files[index].copy(folderId = folderId)
    }

    fun purgeAttachment(id: String) {
        var removed = false
        mutate { value -> removed = value.files.removeAll { it.id == id && it.purpose == StoredFile.PURPOSE_NOTE_AUDIO } }
        if (removed) File(blobDir, "$id.blob").delete()
    }

    fun restoreTrash(kind: String, id: String) = mutate { value ->
        when (kind) {
            "password" -> value.deletedPasswords.firstOrNull { it.id == id }?.let { value.passwords.add(0, it); value.deletedPasswords.remove(it) }
            "note" -> value.deletedNotes.firstOrNull { it.id == id }?.let { value.notes.add(0, it); value.deletedNotes.remove(it) }
            "otp" -> value.deletedOtp.firstOrNull { it.id == id }?.let { value.otp.add(0, it); value.deletedOtp.remove(it) }
            "file" -> value.deletedFiles.firstOrNull { it.id == id }?.let { value.files.add(0, it); value.deletedFiles.remove(it) }
        }
    }

    fun purgeTrash(kind: String, id: String) {
        var blobId: String? = null
        var noteAudioId: String? = null
        mutate { value ->
            when (kind) {
                "password" -> value.deletedPasswords.removeAll { it.id == id }
                "note" -> {
                    noteAudioId = value.deletedNotes.firstOrNull { it.id == id }?.audioFileId?.takeIf(String::isNotBlank)
                    value.deletedNotes.removeAll { it.id == id }
                    noteAudioId?.let { audio -> value.files.removeAll { it.id == audio && it.purpose == StoredFile.PURPOSE_NOTE_AUDIO } }
                }
                "otp" -> value.deletedOtp.removeAll { it.id == id }
                "file" -> { if (value.deletedFiles.any { it.id == id }) blobId = id; value.deletedFiles.removeAll { it.id == id } }
            }
        }
        blobId?.let { File(blobDir, "$it.blob").delete() }
        noteAudioId?.let { File(blobDir, "$it.blob").delete() }
    }

    fun emptyTrash() {
        val blobs = snapshot().let { value -> value.deletedFiles.map { it.id } + value.deletedNotes.mapNotNull { it.audioFileId.takeIf(String::isNotBlank) } }
        mutate { value ->
            val audioIds = value.deletedNotes.map { it.audioFileId }.toSet()
            value.files.removeAll { it.id in audioIds && it.purpose == StoredFile.PURPOSE_NOTE_AUDIO }
            value.deletedPasswords.clear(); value.deletedNotes.clear(); value.deletedOtp.clear(); value.deletedFiles.clear()
        }
        blobs.forEach { File(blobDir, "$it.blob").delete() }
    }

    fun renameFile(id: String, name: String) = mutate { value ->
        val index = value.files.indexOfFirst { it.id == id }
        require(index >= 0) { "FILE_NOT_FOUND" }
        value.files[index] = value.files[index].copy(name = name.trim().take(180))
    }

    private fun validateFolder(folderId: String, kind: String, value: VaultData = snapshot()) {
        if (folderId.isNotBlank()) require(value.folders.any { it.id == folderId && it.kind == kind }) { "INVALID_FOLDER" }
    }

    fun replaceTextFile(id: String, text: String) {
        val bytes = text.toByteArray(Charsets.UTF_8)
        require(bytes.size <= MAX_TEXT_EDIT_BYTES) { "TEXT_TOO_LARGE" }
        val size = bytes.size.toLong()
        val encrypted = try { CryptoBox.encrypt(vaultKey ?: error("VAULT_LOCKED"), bytes, "android-file-v1:$id") } finally { bytes.fill(0) }
        writeBlob(id, encrypted)
        mutate { value ->
            val index = value.files.indexOfFirst { it.id == id }
            require(index >= 0) { "FILE_NOT_FOUND" }
            value.files[index] = value.files[index].copy(size = size)
        }
    }

    @Synchronized
    private fun mutate(change: (VaultData) -> Unit) { change(snapshot()); persist() }

    @Synchronized
    fun lock() {
        vaultKey?.fill(0)
        vaultKey = null
        data = null
        envelope = null
    }

    @SuppressLint("ApplySharedPref", "UseKtx")
    @Synchronized
    fun resetVault() {
        lock()
        check(root.canonicalFile == expectedRoot && root.name == "vault") { "UNSAFE_RESET_PATH" }
        check(root.deleteRecursively() || !root.exists()) { "RESET_FAILED" }
        pepper.delete()
        runCatching { DeviceCredentialCrypto().delete() }
        security.edit().clear().commit()
        uiPreferences.edit().clear().commit()
    }

    private fun persist() {
        val current = envelope ?: error("VAULT_LOCKED")
        val key = vaultKey ?: error("VAULT_LOCKED")
        val plain = snapshot().toJson().toString().toByteArray(Charsets.UTF_8)
        try { current.put("payload", blobJson(CryptoBox.encrypt(key, plain, "android-vault-payload-v1"))) }
        finally { plain.fill(0) }
        writeAtomic(envelopeFile, current.toString().toByteArray(Charsets.UTF_8))
    }

    private fun readEnvelope(): JSONObject = JSONObject(String(envelopeFile.readFully(), Charsets.UTF_8))

    private fun writeBlob(id: String, blob: CipherBlob) {
        val output = ByteArrayOutputStream()
        DataOutputStream(output).use { it.writeInt(blob.iv.size); it.write(blob.iv); it.write(blob.ciphertext) }
        writeAtomic(AtomicFile(File(blobDir, "$id.blob")), output.toByteArray())
    }

    private fun readBlob(id: String): CipherBlob = DataInputStream(ByteArrayInputStream(AtomicFile(File(blobDir, "$id.blob")).readFully())).use {
        val ivSize = it.readInt()
        require(ivSize == 12)
        val iv = ByteArray(ivSize).also(it::readFully)
        val ciphertext = it.readBytes()
        CipherBlob(iv, ciphertext)
    }

    private fun writeAtomic(file: AtomicFile, bytes: ByteArray) {
        val stream = file.startWrite()
        try { stream.write(bytes); stream.fd.sync(); file.finishWrite(stream) }
        catch (error: Throwable) { file.failWrite(stream); throw error }
    }

    private fun deleteInternalTree(target: File, prefix: String) {
        val canonical = target.canonicalFile
        val parent = expectedRoot.parentFile?.canonicalFile
        check(parent != null && canonical.parentFile == parent && canonical.name.startsWith(prefix)) { "UNSAFE_INTERNAL_DELETE" }
        if (canonical.exists()) check(canonical.deleteRecursively()) { "INTERNAL_DELETE_FAILED" }
    }

    private fun validateQuick(mode: QuickMode, credential: CharArray) {
        when (mode) {
            QuickMode.PIN -> require(credential.size in 6..12 && credential.all(Char::isDigit)) { "INVALID_PIN" }
            QuickMode.PATTERN -> require(String(credential).split('-').let { it.size >= 5 && it.distinct().size == it.size && it.all { node -> node.toIntOrNull() in 0..8 } }) { "INVALID_PATTERN" }
            QuickMode.SYSTEM -> error("USE_SYSTEM_QUICK_CONFIGURATOR")
            QuickMode.NONE -> Unit
        }
    }

    private fun checkMaster(current: JSONObject, masterPassword: CharArray) {
        val kdf = current.getJSONObject("kdf")
        val iterations = kdf.getInt("iterations").also { require(it in 100_000..2_000_000) { "INVALID_KDF" } }
        val masterKey = CryptoBox.derive(masterPassword, unb64(kdf.getString("salt")), iterations)
        val verifiedKey = try {
            CryptoBox.decrypt(masterKey, parseBlob(current.getJSONObject("masterWrap")), "android-master-wrap-v1")
        } finally {
            masterKey.fill(0)
            masterPassword.fill('\u0000')
        }
        try {
            check(MessageDigest.isEqual(verifiedKey, vaultKey!!)) { "INVALID_MASTER_PASSWORD" }
        } finally {
            verifiedKey.fill(0)
        }
    }

    private fun requireMaster(current: JSONObject, masterPassword: CharArray) {
        val wait = retryAfterSeconds()
        if (wait > 0) {
            masterPassword.fill('\u0000')
            error("AUTHENTICATION_LOCKED")
        }
        try {
            checkMaster(current, masterPassword)
            clearFailures()
        } catch (error: Throwable) {
            recordFailure()
            throw error
        }
    }

    private fun retryAfterSeconds(): Int {
        val monotonic = remainingLockoutSeconds(
            security.getLong("lockStartedElapsed", 0),
            security.getLong("lockDurationMs", 0),
            SystemClock.elapsedRealtime(),
        )
        val legacy = ((security.getLong("lockedUntil", 0) - System.currentTimeMillis()).coerceIn(0, MAX_LOCKOUT_MS) / 1000L).toInt()
        return maxOf(monotonic, legacy)
    }
    @SuppressLint("ApplySharedPref", "UseKtx")
    private fun recordFailure() {
        val failures = security.getInt("failures", 0) + 1
        val delay = if (failures < 5) 0L else (1L shl (failures - 5).coerceAtMost(8)) * 1_000L
        security.edit()
            .putInt("failures", failures)
            .putLong("lockStartedElapsed", SystemClock.elapsedRealtime())
            .putLong("lockDurationMs", delay)
            .remove("lockedUntil")
            .commit()
    }

    @SuppressLint("ApplySharedPref", "UseKtx")
    private fun clearFailures() {
        security.edit().clear().commit()
    }

    private fun blobJson(blob: CipherBlob) = JSONObject().put("iv", b64(blob.iv)).put("ciphertext", b64(blob.ciphertext))
    private fun parseBlob(json: JSONObject) = CipherBlob(unb64(json.getString("iv")), unb64(json.getString("ciphertext")))
    private fun b64(bytes: ByteArray) = Base64.getEncoder().withoutPadding().encodeToString(bytes)
    private fun unb64(value: String) = Base64.getDecoder().decode(value)

    companion object {
        private const val PREF_HIDE_PATTERN_TRACE = "hide_pattern_trace"
        const val MAX_TEXT_EDIT_BYTES = 2 * 1024 * 1024
        const val MAX_FILE_BYTES = 1024 * 1024 * 1024
        const val MAX_IN_MEMORY_READ_BYTES = 32 * 1024 * 1024
        private const val MAX_LOCKOUT_MS = 256_000L
        const val BACKUP_MIME = "application/vnd.nocturne.vault-backup"
        const val BACKUP_EXTENSION = ".nocturne"
        private val BACKUP_MAGIC = "NOCTBKP1".toByteArray(Charsets.US_ASCII)
        private const val BACKUP_VERSION = 1
        private const val BACKUP_BUFFER_BYTES = 256 * 1024
        private const val MAX_BACKUP_ENVELOPE_BYTES = 16 * 1024 * 1024
        private const val MAX_BACKUP_FILES = 10_000
        private const val MAX_BACKUP_TOTAL_ENCRYPTED_BYTES = 2L * 1024L * 1024L * 1024L
        private const val MIN_IMPORT_FREE_SPACE_BYTES = 256L * 1024L * 1024L
        private const val MIN_ENCRYPTED_BLOB_BYTES = 32L
        private const val ENCRYPTED_BLOB_OVERHEAD_BYTES = 32L
        private const val MAX_ENCRYPTED_BLOB_BYTES = MAX_FILE_BYTES.toLong() + 64L
        private val DISCARD_OUTPUT = object : OutputStream() {
            override fun write(value: Int) = Unit
            override fun write(buffer: ByteArray, offset: Int, length: Int) = Unit
        }
    }
}

internal fun remainingLockoutSeconds(startedElapsed: Long, durationMs: Long, nowElapsed: Long): Int {
    val boundedDuration = durationMs.coerceIn(0, 256_000L)
    if (boundedDuration == 0L || startedElapsed <= 0L) return 0
    val elapsed = if (nowElapsed >= startedElapsed) nowElapsed - startedElapsed else 0L
    val remaining = (boundedDuration - elapsed).coerceAtLeast(0L)
    return ((remaining + 999L) / 1_000L).toInt()
}

class VaultBackupException(val code: String, cause: Throwable? = null) : SecurityException(code, cause)

internal fun validateImportedVaultData(value: VaultData): List<StoredFile> {
    fun validId(id: String) = id.matches(Regex("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"))
    fun bounded(text: String, max: Int) = require(text.length <= max) { "BACKUP_FIELD_TOO_LARGE" }
    val records = value.passwords + value.deletedPasswords
    val notes = value.notes + value.deletedNotes
    val otp = value.otp + value.deletedOtp
    val files = backupFiles(value)
    value.protectedSpace?.let {
        require(ProtectedSpaceProtocol.isValidIdentity(it)) { "BACKUP_INVALID_PROTECTED_SPACE_IDENTITY" }
    }
    require(records.size <= 100_000 && notes.size <= 100_000 && otp.size <= 100_000 && value.folders.size <= 100_000 && files.size <= 100_000) { "BACKUP_TOO_MANY_RECORDS" }
    val allIds = records.map { it.id } + notes.map { it.id } + otp.map { it.id } + value.folders.map { it.id } + files.map { it.id }
    require(allIds.all(::validId) && allIds.distinct().size == allIds.size) { "BACKUP_INVALID_IDS" }

    records.forEach {
        bounded(it.title, 512); bounded(it.username, 4096); bounded(it.password, 4096); bounded(it.url, 4096); bounded(it.notes, VaultRepository.MAX_TEXT_EDIT_BYTES); bounded(it.appSignatureSha256, 1024)
        require(it.appSignatureSha256.isBlank() || it.appSignatureSha256.matches(Regex("[0-9a-f]{64}(,[0-9a-f]{64})*"))) { "BACKUP_INVALID_APP_SIGNATURE" }
    }
    notes.forEach { bounded(it.title, 512); bounded(it.body, VaultRepository.MAX_TEXT_EDIT_BYTES); require(it.audioDurationMs in 0..86_400_000L) { "BACKUP_INVALID_AUDIO" } }
    otp.forEach { bounded(it.issuer, 512); bounded(it.account, 512); bounded(it.secret, 1024) }
    value.folders.forEach { require(it.kind in setOf("password", "note", "file") && it.name.isNotBlank() && it.name.length <= 80) { "BACKUP_INVALID_FOLDER" } }
    files.forEach {
        require(it.name.isNotBlank() && it.name.length <= 180 && it.mime.length <= 120 && it.size in 0..VaultRepository.MAX_FILE_BYTES.toLong()) { "BACKUP_INVALID_FILE" }
        require(it.purpose in setOf(StoredFile.PURPOSE_LIBRARY, StoredFile.PURPOSE_NOTE_AUDIO)) { "BACKUP_INVALID_FILE" }
    }
    val folders = value.folders.associateBy { it.id }
    value.folders.forEach { folder ->
        if (folder.parentId.isNotBlank()) require(folders[folder.parentId]?.kind == folder.kind) { "BACKUP_INVALID_FOLDER_TREE" }
        val visited = mutableSetOf(folder.id)
        var parent = folder.parentId
        while (parent.isNotBlank()) { require(visited.add(parent)) { "BACKUP_FOLDER_CYCLE" }; parent = folders[parent]?.parentId ?: error("BACKUP_INVALID_FOLDER_TREE") }
    }
    (value.passwords + value.notes).forEach { item ->
        val folderId = when (item) { is PasswordItem -> item.folderId; is NoteItem -> item.folderId; else -> "" }
        val kind = if (item is PasswordItem) "password" else "note"
        if (folderId.isNotBlank()) require(folders[folderId]?.kind == kind) { "BACKUP_INVALID_FOLDER_REFERENCE" }
    }
    value.files.forEach { if (it.folderId.isNotBlank()) require(folders[it.folderId]?.kind == "file") { "BACKUP_INVALID_FOLDER_REFERENCE" } }
    val fileMap = value.files.associateBy { it.id }
    notes.forEach { note -> if (note.audioFileId.isNotBlank()) require(fileMap[note.audioFileId]?.purpose == StoredFile.PURPOSE_NOTE_AUDIO) { "BACKUP_INVALID_AUDIO_REFERENCE" } }
    return files
}

private fun backupFiles(value: VaultData): List<StoredFile> {
    val files = value.files + value.deletedFiles
    require(files.map { it.id }.distinct().size == files.size) { "BACKUP_DUPLICATE_FILE_IDS" }
    return files
}

private fun checkedBlobFile(directory: File, id: String): File {
    require(id.matches(Regex("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"))) { "BACKUP_INVALID_ID" }
    val parent = directory.canonicalFile
    return File(parent, "$id.blob").canonicalFile.also { require(it.parentFile == parent) { "BACKUP_INVALID_PATH" } }
}

private fun writeBackupString(output: DataOutputStream, value: String) {
    val bytes = value.toByteArray(Charsets.UTF_8)
    require(bytes.size in 1..128) { "BACKUP_INVALID_STRING" }
    output.writeInt(bytes.size)
    output.write(bytes)
}

private fun readBackupString(input: DataInputStream): String {
    val length = input.readInt()
    require(length in 1..128) { "BACKUP_INVALID_STRING" }
    return String(ByteArray(length).also(input::readFully), Charsets.UTF_8)
}

private fun copyExactly(input: InputStream, output: OutputStream, byteCount: Long) {
    val buffer = ByteArray(256 * 1024)
    var remaining = byteCount
    try {
        while (remaining > 0) {
            if (Thread.currentThread().isInterrupted) throw java.io.InterruptedIOException("IMPORT_CANCELLED")
            val read = input.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())
            require(read > 0) { "BACKUP_TRUNCATED" }
            output.write(buffer, 0, read)
            buffer.fill(0, 0, read)
            remaining -= read
        }
    } finally { buffer.fill(0) }
}

internal fun recoverInterruptedVaultRoot(filesDir: File): File {
    val parent = filesDir.canonicalFile
    val root = File(parent, "vault").canonicalFile
    require(root.parentFile == parent) { "UNSAFE_VAULT_PATH" }
    val siblings = parent.listFiles().orEmpty().filter { it.parentFile?.canonicalFile == parent }
    val previous = siblings
        .filter { it.isDirectory && it.name.startsWith("vault-previous-") }
        .sortedByDescending(File::lastModified)
    val recoverable = previous.firstOrNull { File(it, "vault.nvlt").isFile && File(it, "blobs").isDirectory }
    if (!File(root, "vault.nvlt").isFile && recoverable != null) {
        if (root.exists()) check(root.deleteRecursively()) { "VAULT_RECOVERY_FAILED" }
        check(recoverable.renameTo(root)) { "VAULT_RECOVERY_FAILED" }
    }
    root.mkdirs()
    if (File(root, "vault.nvlt").isFile) {
        siblings.filter { candidate ->
            candidate.isDirectory && (candidate.name.startsWith("vault-import-") || candidate.name.startsWith("vault-previous-"))
        }.forEach { candidate ->
            if (candidate.exists() && candidate != root) runCatching { candidate.deleteRecursively() }
        }
    }
    return root
}

private fun writeSynced(target: File, bytes: ByteArray) {
    try { FileOutputStream(target).use { it.write(bytes); it.fd.sync() } } finally { bytes.fill(0) }
}
