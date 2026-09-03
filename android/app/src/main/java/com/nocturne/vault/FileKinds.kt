package com.nocturne.vault

import android.webkit.MimeTypeMap

enum class VaultFileKind { IMAGE, VIDEO, AUDIO, PDF, DOCUMENT, OTHER }

private val imageExtensions = setOf(
    "jpg", "jpeg", "jpe", "png", "gif", "webp", "bmp", "wbmp", "heic", "heif", "avif", "dng", "tif", "tiff",
)
private val videoExtensions = setOf(
    "mp4", "m4v", "mov", "webm", "mkv", "avi", "3gp", "3g2", "ts", "mts", "m2ts", "mpg", "mpeg", "mpe", "flv", "ogv", "vob", "wmv",
)
private val audioExtensions = setOf(
    "mp3", "m4a", "aac", "wav", "wave", "flac", "ogg", "oga", "opus", "amr", "3ga", "aiff", "aif", "wma", "mid", "midi",
)
private val documentExtensions = setOf(
    "txt", "md", "markdown", "json", "xml", "csv", "tsv", "log", "yaml", "yml", "toml", "ini", "conf", "properties",
    "html", "htm", "css", "scss", "js", "ts", "kt", "java", "py", "c", "cpp", "h", "sh", "ps1", "bat", "sql", "tex", "vtt", "srt",
    "rtf", "doc", "docx", "docm", "xls", "xlsx", "xlsm", "ppt", "pptx", "pptm", "odt", "ods", "odp", "fodt", "fods", "fodp", "epub",
)

fun StoredFile.extension(): String = name.substringAfterLast('.', "").lowercase()

fun StoredFile.kind(): VaultFileKind {
    val extension = extension()
    val normalizedMime = mime.lowercase().substringBefore(';')
    return when {
        normalizedMime.startsWith("image/") || extension in imageExtensions -> VaultFileKind.IMAGE
        normalizedMime.startsWith("video/") || extension in videoExtensions -> VaultFileKind.VIDEO
        normalizedMime.startsWith("audio/") || extension in audioExtensions -> VaultFileKind.AUDIO
        normalizedMime == "application/pdf" || extension == "pdf" -> VaultFileKind.PDF
        normalizedMime.startsWith("text/") || extension in documentExtensions || normalizedMime.startsWith("application/") -> VaultFileKind.DOCUMENT
        else -> VaultFileKind.OTHER
    }
}

fun resolvedMimeType(name: String, supplied: String): String {
    val normalized = supplied.lowercase().substringBefore(';').takeIf { it.isNotBlank() && it != "application/octet-stream" }
    val extension = name.substringAfterLast('.', "").lowercase()
    val explicit = when (extension) {
            "mkv" -> "video/x-matroska"
            "avi" -> "video/x-msvideo"
            "mov" -> "video/quicktime"
            "m2ts", "mts", "ts" -> "video/mp2t"
            "flv" -> "video/x-flv"
            "wmv" -> "video/x-ms-wmv"
            "opus" -> "audio/opus"
            "flac" -> "audio/flac"
            "m4a" -> "audio/mp4"
            "heic" -> "image/heic"
            "heif" -> "image/heif"
            "avif" -> "image/avif"
            "docx", "docm" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            "xlsx", "xlsm" -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            "pptx", "pptm" -> "application/vnd.openxmlformats-officedocument.presentationml.presentation"
            "odt" -> "application/vnd.oasis.opendocument.text"
            "ods" -> "application/vnd.oasis.opendocument.spreadsheet"
            "odp" -> "application/vnd.oasis.opendocument.presentation"
            "epub" -> "application/epub+zip"
            else -> null
        }
    val inferred = explicit ?: runCatching { MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension) }.getOrNull()
    val expectedPrefix = when {
        extension in imageExtensions -> "image/"
        extension in videoExtensions -> "video/"
        extension in audioExtensions -> "audio/"
        else -> null
    }
    return when {
        inferred != null && expectedPrefix != null && normalized?.startsWith(expectedPrefix) != true -> inferred
        normalized != null -> normalized
        inferred != null -> inferred
        else -> "application/octet-stream"
    }
}
