package com.nocturne.vault

import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.zip.ZipInputStream

fun supportsTextDocumentPreview(item: StoredFile): Boolean {
    val extension = item.name.substringAfterLast('.', "").lowercase()
    return item.mime.startsWith("text/") || extension in setOf(
        "txt", "md", "markdown", "json", "xml", "csv", "tsv", "log", "yaml", "yml", "toml", "ini", "conf", "properties",
        "html", "htm", "css", "scss", "js", "ts", "kt", "java", "py", "c", "cpp", "h", "sh", "ps1", "bat", "sql", "tex", "vtt", "srt",
        "rtf", "docx", "docm", "xlsx", "xlsm", "pptx", "pptm", "odt", "ods", "odp", "fodt", "fods", "fodp", "epub",
    )
}

fun extractDocumentText(item: StoredFile, bytes: ByteArray): String? {
    require(bytes.size <= MAX_DOCUMENT_BYTES) { "DOCUMENT_TOO_LARGE" }
    val extension = item.name.substringAfterLast('.', "").lowercase()
    return when (extension) {
        "docx", "docm" -> extractZipXml(bytes) { it == "word/document.xml" }
        "xlsx", "xlsm" -> extractZipXml(bytes) { it == "xl/sharedStrings.xml" || it.startsWith("xl/worksheets/sheet") }
        "pptx", "pptm" -> extractZipXml(bytes) { it.startsWith("ppt/slides/slide") && it.endsWith(".xml") }
        "odt", "ods", "odp" -> extractZipXml(bytes) { it == "content.xml" }
        "fodt", "fods", "fodp" -> stripXml(bytes.toString(Charsets.UTF_8))
        "epub" -> extractZipXml(bytes) { it.endsWith(".xhtml", true) || it.endsWith(".html", true) || it.endsWith(".htm", true) }
        "rtf" -> bytes.toString(Charsets.UTF_8).replace(Regex("\\\\'[0-9a-fA-F]{2}"), " ").replace(Regex("\\\\[a-zA-Z]+-?\\d* ?"), "").replace(Regex("[{}]"), "").trim().take(MAX_TEXT_CHARS)
        "html", "htm" -> stripXml(bytes.toString(Charsets.UTF_8))
        else -> if (item.mime.startsWith("text/") || extension in PLAIN_TEXT_EXTENSIONS) bytes.toString(Charsets.UTF_8).take(MAX_TEXT_CHARS) else null
    }
}

private fun extractZipXml(bytes: ByteArray, include: (String) -> Boolean): String? {
    val result = StringBuilder()
    ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
        var entries = 0
        var expandedBytes = 0L
        val buffer = ByteArray(16 * 1024)
        while (true) {
            val entry = zip.nextEntry ?: break
            entries++
            require(entries <= MAX_ZIP_ENTRIES) { "DOCUMENT_TOO_COMPLEX" }
            if (!entry.isDirectory) {
                val selected = include(entry.name)
                val output = if (selected) ByteArrayOutputStream() else null
                while (true) {
                    val read = zip.read(buffer)
                    if (read < 0) break
                    expandedBytes += read
                    require(expandedBytes <= MAX_ZIP_EXPANDED_BYTES) { "DOCUMENT_TOO_COMPLEX" }
                    if (output != null) {
                        require(output.size() + read <= MAX_XML_ENTRY_BYTES) { "DOCUMENT_TOO_COMPLEX" }
                        output.write(buffer, 0, read)
                    }
                }
                if (output != null) {
                    if (result.isNotEmpty()) result.append("\n\n")
                    result.append(stripXml(output.toString(Charsets.UTF_8.name())))
                    require(result.length <= MAX_TEXT_CHARS) { "DOCUMENT_TOO_COMPLEX" }
                }
            }
            zip.closeEntry()
        }
    }
    return result.toString().trim().takeIf(String::isNotEmpty)
}

private fun stripXml(value: String): String = value
    .replace(Regex("<[^>]+>"), " ")
    .replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&").replace("&quot;", "\"").replace("&#39;", "'")
    .replace(Regex("[ \\t\\x0B\\f\\r]+"), " ")
    .replace(Regex(" *\\n+ *"), "\n")
    .trim()
    .take(MAX_TEXT_CHARS)

private class PdfSession(val descriptor: ParcelFileDescriptor, val renderer: PdfRenderer) : AutoCloseable {
    val pageCount: Int = renderer.pageCount.coerceAtMost(MAX_PDF_PAGES)
    @Synchronized fun render(index: Int, targetWidth: Int = 1280): Bitmap {
        val page = renderer.openPage(index)
        return try {
            val ratio = page.height.toFloat() / page.width.coerceAtLeast(1)
            val targetHeight = (targetWidth * ratio).toInt().coerceIn(1, 2400)
            Bitmap.createBitmap(targetWidth, targetHeight, Bitmap.Config.ARGB_8888).also { bitmap ->
                bitmap.eraseColor(android.graphics.Color.WHITE)
                page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
            }
        } finally { page.close() }
    }
    override fun close() { renderer.close(); descriptor.close() }
}

@Composable
fun PdfDocumentPreview(repository: VaultRepository, item: StoredFile, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    var session by remember(item.id) { mutableStateOf<PdfSession?>(null) }
    var error by remember(item.id) { mutableStateOf("") }
    LaunchedEffect(item.id) {
        val result = withContext(Dispatchers.IO) {
            runCatching {
                val temporary = File.createTempFile("pdf-preview-", ".pdf", context.cacheDir)
                try {
                    temporary.outputStream().buffered().use { repository.exportFile(item.id, it) }
                    val descriptor = ParcelFileDescriptor.open(temporary, ParcelFileDescriptor.MODE_READ_ONLY)
                    temporary.delete()
                    PdfSession(descriptor, PdfRenderer(descriptor))
                } finally {
                    temporary.delete()
                }
            }
        }
        result.onSuccess { session = it }.onFailure { error = "Не удалось открыть PDF" }
    }
    DisposableEffect(item.id) { onDispose { session?.close(); session = null } }
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        val current = session
        when {
            error.isNotEmpty() -> Text(error, color = NocturneDanger)
            current == null -> CircularProgressIndicator()
            else -> PdfPages(current, Modifier.fillMaxSize())
        }
    }
}

@Composable
private fun PdfPages(session: PdfSession, modifier: Modifier = Modifier) {
    var scale by remember(session) { mutableFloatStateOf(1f) }
    val horizontalScroll = rememberScrollState()
    val transformState = rememberTransformableState { _, zoomChange, _, _ ->
        scale = (scale * zoomChange).coerceIn(1f, 5f)
    }
    val targetWidth = when {
        scale >= 3f -> 3072
        scale >= 1.7f -> 2048
        else -> 1280
    }
    BoxWithConstraints(modifier) {
        val viewportWidth = maxWidth
        Box(Modifier.fillMaxSize().transformable(transformState, canPan = { false }).horizontalScroll(horizontalScroll)) {
            LazyColumn(Modifier.width(viewportWidth * scale).fillMaxHeight()) {
                items((0 until session.pageCount).toList(), key = { it }) { page -> PdfPage(session, page, targetWidth) }
            }
        }
    }
}

@Composable
private fun PdfPage(session: PdfSession, index: Int, targetWidth: Int) {
    var bitmap by remember(index, targetWidth) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(index, targetWidth) { bitmap = withContext(Dispatchers.IO) { session.render(index, targetWidth) } }
    DisposableEffect(index, targetWidth) { onDispose { bitmap?.recycle(); bitmap = null } }
    val image = bitmap
    if (image == null) Box(Modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
    else {
        Box(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 6.dp, vertical = 4.dp)
                .aspectRatio(image.width.toFloat() / image.height.coerceAtLeast(1))
                .background(Color.White),
            contentAlignment = Alignment.Center,
        ) {
            Image(
                image.asImageBitmap(),
                "Страница ${index + 1}",
                Modifier.fillMaxSize(),
                contentScale = ContentScale.FillBounds,
            )
        }
    }
}

private val PLAIN_TEXT_EXTENSIONS = setOf(
    "txt", "md", "markdown", "json", "xml", "csv", "tsv", "log", "yaml", "yml", "toml", "ini", "conf", "properties",
    "css", "scss", "js", "ts", "kt", "java", "py", "c", "cpp", "h", "sh", "ps1", "bat", "sql", "tex", "vtt", "srt",
    "fodt", "fods", "fodp",
)
private const val MAX_DOCUMENT_BYTES = 16 * 1024 * 1024
private const val MAX_TEXT_CHARS = 2_000_000
private const val MAX_ZIP_ENTRIES = 2_048
private const val MAX_XML_ENTRY_BYTES = 4 * 1024 * 1024
private const val MAX_ZIP_EXPANDED_BYTES = 32L * 1024L * 1024L
private const val MAX_PDF_PAGES = 2_000
