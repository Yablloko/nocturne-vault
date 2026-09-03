package com.nocturne.vault

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class DocumentAndAudioSupportTest {
    @Test fun audioPlayerMetadataIsHumanReadableAtBoundaries() {
        assertEquals("0:00", formatAudioTime(-1))
        assertEquals("1:05", formatAudioTime(65_999))
        assertEquals("68 КБ", formatAudioSize(68 * 1024L))
        assertEquals("1,5 МБ", formatAudioSize(1_572_864L).replace('.', ','))
    }

    @Test fun textDocumentPreviewRecognizesAndExtractsSupportedFormats() {
        val markdown = StoredFile(name = "note.md", mime = "application/octet-stream", size = 8)
        val html = StoredFile(name = "page.html", mime = "text/html", size = 32)
        assertTrue(supportsTextDocumentPreview(markdown))
        assertEquals("# secret", extractDocumentText(markdown, "# secret".toByteArray()))
        assertEquals("Nocturne vault", extractDocumentText(html, "<b>Nocturne</b> vault".toByteArray()))
    }

    @Test fun fileKindsFallBackToExtensionWhenProviderReturnsGenericMime() {
        assertEquals(VaultFileKind.VIDEO, StoredFile(name = "clip.mkv", mime = "application/octet-stream", size = 1).kind())
        assertEquals(VaultFileKind.AUDIO, StoredFile(name = "voice.opus", mime = "application/octet-stream", size = 1).kind())
        assertEquals(VaultFileKind.IMAGE, StoredFile(name = "photo.heic", mime = "application/octet-stream", size = 1).kind())
        assertEquals(VaultFileKind.PDF, StoredFile(name = "paper.PDF", mime = "application/octet-stream", size = 1).kind())
        assertEquals(VaultFileKind.DOCUMENT, StoredFile(name = "book.epub", mime = "application/octet-stream", size = 1).kind())
        assertEquals("video/x-matroska", resolvedMimeType("clip.mkv", "application/octet-stream"))
        assertEquals("video/x-matroska", resolvedMimeType("clip.mkv", "application/pdf"))
    }

    @Test fun skippedZipEntriesShareTheExpansionBudget() {
        val archive = ByteArrayOutputStream().also { output ->
            ZipOutputStream(output).use { zip ->
                zip.putNextEntry(ZipEntry("ignored.bin"))
                val chunk = ByteArray(1024 * 1024)
                repeat(33) { zip.write(chunk) }
                zip.closeEntry()
                zip.putNextEntry(ZipEntry("word/document.xml"))
                zip.write("<p>safe</p>".toByteArray())
                zip.closeEntry()
            }
        }.toByteArray()
        val item = StoredFile(name = "bomb.docx", mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size = archive.size.toLong())
        assertThrows(IllegalArgumentException::class.java) { extractDocumentText(item, archive) }
    }

    @Test fun decodedImagesStayWithinDimensionAndPixelBudgets() {
        assertEquals(1, bitmapSampleSize(1920, 1080, 4096, 8_000_000))
        assertEquals(2, bitmapSampleSize(8000, 4000, 4096, 8_000_000))
        assertEquals(16, bitmapSampleSize(30_000, 30_000, 4096, 8_000_000))
    }

}
