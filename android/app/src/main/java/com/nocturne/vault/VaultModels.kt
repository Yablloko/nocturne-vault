package com.nocturne.vault

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

data class PasswordItem(
    val id: String = UUID.randomUUID().toString(),
    val title: String,
    val username: String = "",
    val password: String,
    val url: String = "",
    val notes: String = "",
    val folderId: String = "",
    val appSignatureSha256: String = "",
)

data class NoteItem(
    val id: String = UUID.randomUUID().toString(),
    val title: String,
    val body: String = "",
    val folderId: String = "",
    val audioFileId: String = "",
    val audioDurationMs: Long = 0,
)

data class VaultFolder(
    val id: String = UUID.randomUUID().toString(),
    val name: String,
    val kind: String,
    val parentId: String = "",
)

data class OtpItem(
    val id: String = UUID.randomUUID().toString(),
    val issuer: String,
    val account: String,
    val secret: String,
)

data class StoredFile(
    val id: String = UUID.randomUUID().toString(),
    val name: String,
    val mime: String,
    val size: Long,
    val folderId: String = "",
    val purpose: String = PURPOSE_LIBRARY,
) {
    companion object {
        const val PURPOSE_LIBRARY = "library"
        const val PURPOSE_NOTE_AUDIO = "note_audio"
    }
}

data class PrivacySettings(
    val allowScreenshots: Boolean = false,
    val autoLockSeconds: Int = 300,
    val clearClipboardOnBackground: Boolean = true,
    val clipboardClearSeconds: Int = 30,
    val anonymousKeyboard: Boolean = true,
    val hidePatternTrace: Boolean = true,
) {
    init {
        require(autoLockSeconds in ALLOWED_AUTO_LOCK) { "INVALID_AUTO_LOCK" }
        require(clipboardClearSeconds in ALLOWED_CLIPBOARD_TIMEOUTS) { "INVALID_CLIPBOARD_TIMEOUT" }
    }

    fun toJson() = JSONObject()
        .put("allowScreenshots", allowScreenshots)
        .put("autoLockSeconds", autoLockSeconds)
        .put("clearClipboardOnBackground", clearClipboardOnBackground)
        .put("clipboardClearSeconds", clipboardClearSeconds)
        .put("anonymousKeyboard", anonymousKeyboard)
        .put("hidePatternTrace", hidePatternTrace)

    companion object {
        val ALLOWED_AUTO_LOCK = setOf(30, 60, 120, 300, 600, 1800)
        val ALLOWED_CLIPBOARD_TIMEOUTS = setOf(0, 5, 15, 30, 60, 120)

        fun fromJson(json: JSONObject?) = if (json == null) PrivacySettings() else PrivacySettings(
            allowScreenshots = json.optBoolean("allowScreenshots", false),
            autoLockSeconds = json.optInt("autoLockSeconds", 300).takeIf(ALLOWED_AUTO_LOCK::contains) ?: 300,
            clearClipboardOnBackground = json.optBoolean("clearClipboardOnBackground", true),
            clipboardClearSeconds = json.optInt("clipboardClearSeconds", 30).takeIf(ALLOWED_CLIPBOARD_TIMEOUTS::contains) ?: 30,
            anonymousKeyboard = json.optBoolean("anonymousKeyboard", true),
            hidePatternTrace = json.optBoolean("hidePatternTrace", true),
        )
    }
}

data class VaultData(
    val passwords: MutableList<PasswordItem> = mutableListOf(),
    val notes: MutableList<NoteItem> = mutableListOf(),
    val otp: MutableList<OtpItem> = mutableListOf(),
    val files: MutableList<StoredFile> = mutableListOf(),
    val folders: MutableList<VaultFolder> = mutableListOf(),
    val deletedPasswords: MutableList<PasswordItem> = mutableListOf(),
    val deletedNotes: MutableList<NoteItem> = mutableListOf(),
    val deletedOtp: MutableList<OtpItem> = mutableListOf(),
    val deletedFiles: MutableList<StoredFile> = mutableListOf(),
    var settings: PrivacySettings = PrivacySettings(),
    var protectedSpace: ProtectedSpaceIdentity? = null,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("passwords", JSONArray(passwords.map { passwordJson(it) }))
        .put("notes", JSONArray(notes.map { noteJson(it) }))
        .put("otp", JSONArray(otp.map { JSONObject().put("id", it.id).put("issuer", it.issuer).put("account", it.account).put("secret", it.secret) }))
        .put("files", JSONArray(files.map { fileJson(it) }))
        .put("folders", JSONArray(folders.map { JSONObject().put("id", it.id).put("name", it.name).put("kind", it.kind).put("parentId", it.parentId) }))
        .put("trash", JSONObject()
            .put("passwords", JSONArray(deletedPasswords.map { passwordJson(it) }))
            .put("notes", JSONArray(deletedNotes.map { noteJson(it) }))
            .put("otp", JSONArray(deletedOtp.map { JSONObject().put("id", it.id).put("issuer", it.issuer).put("account", it.account).put("secret", it.secret) }))
            .put("files", JSONArray(deletedFiles.map { fileJson(it) })))
        .put("settings", settings.toJson())
        .put("protectedSpace", protectedSpace?.let {
            JSONObject().put("publicKey", it.publicKey).put("privateKey", it.privateKey).put("counter", it.counter)
        } ?: JSONObject.NULL)

    fun copyForUi(): VaultData = fromJson(toJson())

    val trashCount: Int get() = deletedPasswords.size + deletedNotes.size + deletedOtp.size + deletedFiles.size

    companion object {
        private fun passwordJson(it: PasswordItem) = JSONObject().put("id", it.id).put("title", it.title).put("username", it.username).put("password", it.password).put("url", it.url).put("notes", it.notes).put("folderId", it.folderId).put("appSignatureSha256", it.appSignatureSha256)
        private fun noteJson(it: NoteItem) = JSONObject().put("id", it.id).put("title", it.title).put("body", it.body).put("folderId", it.folderId).put("audioFileId", it.audioFileId).put("audioDurationMs", it.audioDurationMs)
        private fun fileJson(it: StoredFile) = JSONObject().put("id", it.id).put("name", it.name).put("mime", it.mime).put("size", it.size).put("folderId", it.folderId).put("purpose", it.purpose)
        private fun password(json: JSONObject) = PasswordItem(json.getString("id"), json.getString("title"), json.optString("username"), json.getString("password"), json.optString("url"), json.optString("notes"), json.optString("folderId"), json.optString("appSignatureSha256"))
        private fun note(json: JSONObject) = NoteItem(json.getString("id"), json.getString("title"), json.optString("body"), json.optString("folderId"), json.optString("audioFileId"), json.optLong("audioDurationMs"))
        private fun file(json: JSONObject) = StoredFile(json.getString("id"), json.getString("name"), json.optString("mime", "application/octet-stream"), json.getLong("size"), json.optString("folderId"), json.optString("purpose", StoredFile.PURPOSE_LIBRARY))

        fun fromJson(json: JSONObject): VaultData {
            fun array(name: String) = json.optJSONArray(name) ?: JSONArray()
            val trash = json.optJSONObject("trash") ?: JSONObject()
            fun trashArray(name: String) = trash.optJSONArray(name) ?: JSONArray()
            return VaultData(
                passwords = MutableList(array("passwords").length()) { password(array("passwords").getJSONObject(it)) },
                notes = MutableList(array("notes").length()) { note(array("notes").getJSONObject(it)) },
                otp = MutableList(array("otp").length()) { index -> array("otp").getJSONObject(index).let { OtpItem(it.getString("id"), it.optString("issuer"), it.optString("account"), it.getString("secret")) } },
                files = MutableList(array("files").length()) { file(array("files").getJSONObject(it)) },
                folders = MutableList(array("folders").length()) { index -> array("folders").getJSONObject(index).let { VaultFolder(it.getString("id"), it.getString("name"), it.getString("kind"), it.optString("parentId")) } },
                deletedPasswords = MutableList(trashArray("passwords").length()) { password(trashArray("passwords").getJSONObject(it)) },
                deletedNotes = MutableList(trashArray("notes").length()) { note(trashArray("notes").getJSONObject(it)) },
                deletedOtp = MutableList(trashArray("otp").length()) { index -> trashArray("otp").getJSONObject(index).let { OtpItem(it.getString("id"), it.optString("issuer"), it.optString("account"), it.getString("secret")) } },
                deletedFiles = MutableList(trashArray("files").length()) { file(trashArray("files").getJSONObject(it)) },
                settings = PrivacySettings.fromJson(json.optJSONObject("settings")),
                protectedSpace = json.optJSONObject("protectedSpace")?.let {
                    ProtectedSpaceIdentity(it.getString("publicKey"), it.getString("privateKey"), it.optLong("counter"))
                },
            )
        }
    }
}

enum class QuickMode { NONE, PIN, PATTERN, SYSTEM }

sealed interface Gate {
    data object Onboarding : Gate
    data object Create : Gate
    data object Master : Gate
    data class MasterRecovery(val mode: QuickMode) : Gate
    data class Quick(val mode: QuickMode) : Gate
    data object Open : Gate
}

data class UnlockResult(val unlocked: Boolean, val retryAfterSeconds: Int = 0)

enum class ImportStage { QUEUED, READING, ENCRYPTING, DONE, FAILED }

data class ImportItemState(
    val id: String = UUID.randomUUID().toString(),
    val name: String,
    val progress: Float = 0f,
    val stage: ImportStage = ImportStage.QUEUED,
    val message: String = "",
)

data class ImportUiState(
    val items: List<ImportItemState> = emptyList(),
    val collapsed: Boolean = false,
) {
    val active get() = items.any { it.stage == ImportStage.QUEUED || it.stage == ImportStage.READING || it.stage == ImportStage.ENCRYPTING }
    val completedCount get() = items.count { it.stage == ImportStage.DONE }
    val overallProgress get() = if (items.isEmpty()) 0f else items.sumOf { it.progress.toDouble() }.toFloat() / items.size
}

data class AudioAttachment(val fileId: String, val durationMs: Long)
