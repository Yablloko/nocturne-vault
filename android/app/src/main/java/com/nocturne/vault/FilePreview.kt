package com.nocturne.vault

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaDataSource
import android.media.MediaMetadataRetriever
import androidx.annotation.OptIn
import androidx.compose.foundation.Image
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForwardIos
import androidx.compose.material.icons.automirrored.rounded.InsertDriveFile
import androidx.compose.material.icons.rounded.ArrowBackIosNew
import androidx.compose.material.icons.rounded.AudioFile
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.PlayCircle
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.SaveAlt
import androidx.compose.material.icons.rounded.DriveFileRenameOutline
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.TextButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.ByteArrayDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlin.math.abs
import java.util.concurrent.Semaphore

private class MemoryMediaDataSource(private val bytes: ByteArray) : MediaDataSource() {
    override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int {
        if (position >= bytes.size) return -1
        val count = minOf(size, bytes.size - position.toInt())
        bytes.copyInto(buffer, offset, position.toInt(), position.toInt() + count)
        return count
    }
    override fun getSize(): Long = bytes.size.toLong()
    override fun close() = Unit
}

suspend fun loadMediaThumbnail(repository: VaultRepository, item: StoredFile): Bitmap? = withContext(Dispatchers.IO) {
    if (item.size > MAX_THUMBNAIL_SOURCE_BYTES) return@withContext null
    thumbnailSlots.acquire()
    try {
        val bytes = runCatching { repository.readFile(item.id) }.getOrNull() ?: return@withContext null
        try {
            when {
                item.kind() == VaultFileKind.IMAGE -> decodeSampledBitmap(bytes, 768)
                item.kind() == VaultFileKind.VIDEO -> MediaMetadataRetriever().run {
                    try { setDataSource(MemoryMediaDataSource(bytes)); getFrameAtTime(-1, MediaMetadataRetriever.OPTION_CLOSEST_SYNC) }
                    finally { release() }
                }
                else -> null
            }
        } finally { bytes.fill(0) }
    } finally { thumbnailSlots.release() }
}

@Composable
fun MediaThumbnail(repository: VaultRepository, item: StoredFile, modifier: Modifier = Modifier, crop: Boolean = false) {
    var bitmap by remember(item.id) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(item.id) { bitmap = loadMediaThumbnail(repository, item) }
    Box(modifier.background(ColorTokens.preview), contentAlignment = Alignment.Center) {
        val image = bitmap
        if (image != null) {
            Image(image.asImageBitmap(), item.name, Modifier.fillMaxSize(), contentScale = if (crop) ContentScale.Crop else ContentScale.Fit)
        } else {
            Icon(
                when {
                    item.kind() == VaultFileKind.AUDIO -> Icons.Rounded.AudioFile
                    item.kind() == VaultFileKind.PDF -> Icons.Rounded.Description
                    else -> Icons.AutoMirrored.Rounded.InsertDriveFile
                },
                null,
                tint = NocturneMuted,
                modifier = Modifier.size(42.dp),
            )
        }
    }
}

private fun decodeSampledBitmap(bytes: ByteArray, maxDimension: Int): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    val sample = bitmapSampleSize(bounds.outWidth, bounds.outHeight, maxDimension, MAX_DECODED_IMAGE_PIXELS)
    val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
    if (bitmap.width > maxDimension || bitmap.height > maxDimension || bitmap.width.toLong() * bitmap.height.toLong() > MAX_DECODED_IMAGE_PIXELS) {
        bitmap.recycle()
        return null
    }
    return bitmap
}

internal fun bitmapSampleSize(width: Int, height: Int, maxDimension: Int, maxPixels: Long): Int {
    require(width > 0 && height > 0 && maxDimension > 0 && maxPixels > 0) { "INVALID_IMAGE_BOUNDS" }
    var sample = 1
    while (sample < (1 shl 30)) {
        val scaledWidth = (width + sample - 1L) / sample
        val scaledHeight = (height + sample - 1L) / sample
        if (scaledWidth <= maxDimension && scaledHeight <= maxDimension && scaledWidth * scaledHeight <= maxPixels) return sample
        sample *= 2
    }
    return sample
}

private object ColorTokens { val preview = androidx.compose.ui.graphics.Color(0xFF111217) }

@Composable
fun FileViewer(
    repository: VaultRepository,
    files: List<StoredFile>,
    initialId: String,
    onDismiss: () -> Unit,
    onExport: (StoredFile) -> Unit,
    onDelete: (String) -> Unit,
    onRename: (String, String) -> Unit,
    onSaveText: (String, String) -> Unit,
    folders: List<VaultFolder>,
    onMove: (String, String) -> Unit,
    onUserActivity: () -> Unit,
) {
    if (files.isEmpty()) return
    val pagerState = rememberPagerState(initialPage = files.indexOfFirst { it.id == initialId }.coerceAtLeast(0), pageCount = { files.size })
    val scope = rememberCoroutineScope()
    val item = files[pagerState.currentPage.coerceIn(files.indices)]
    var menu by remember { mutableStateOf(false) }
    var renaming by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf(false) }
    var moving by remember { mutableStateOf(false) }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Surface(Modifier.fillMaxSize(), color = NocturneNight) {
            Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().trackUserActivity(onUserActivity)) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = onDismiss) { Icon(Icons.Rounded.Close, "Закрыть") }
                    Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(item.name, maxLines = 1, fontSize = 14.sp)
                        Text("${pagerState.currentPage + 1} из ${files.size}", color = NocturneMuted, fontSize = 12.sp)
                    }
                    Box {
                        IconButton(onClick = { menu = true }) { Icon(Icons.Rounded.MoreVert, "Действия") }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(text = { Text("Сохранить копию") }, leadingIcon = { Icon(Icons.Rounded.SaveAlt, null) }, onClick = { menu = false; onExport(item) })
                            DropdownMenuItem(text = { Text("Переименовать") }, leadingIcon = { Icon(Icons.Rounded.DriveFileRenameOutline, null) }, onClick = { menu = false; renaming = true })
                            DropdownMenuItem(text = { Text("Переместить в папку") }, leadingIcon = { Icon(Icons.AutoMirrored.Rounded.InsertDriveFile, null) }, onClick = { menu = false; moving = true })
                            if (isEditableText(item) && item.size <= VaultRepository.MAX_TEXT_EDIT_BYTES) DropdownMenuItem(text = { Text("Редактировать") }, leadingIcon = { Icon(Icons.Rounded.Edit, null) }, onClick = { menu = false; editing = true })
                            DropdownMenuItem(text = { Text("В корзину", color = NocturneDanger) }, leadingIcon = { Icon(Icons.Rounded.Delete, null, tint = NocturneDanger) }, onClick = { menu = false; onDelete(item.id) })
                        }
                    }
                }
                Box(Modifier.fillMaxSize().weight(1f).background(ColorTokens.preview), contentAlignment = Alignment.Center) {
                    HorizontalPager(state = pagerState, modifier = Modifier.fillMaxSize(), beyondViewportPageCount = 1, key = { files[it].id }) { page ->
                        FilePage(repository, files[page]) { direction ->
                            scope.launch { pagerState.animateScrollToPage((page + direction).coerceIn(files.indices)) }
                        }
                    }
                    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                        IconButton(onClick = { scope.launch { pagerState.animateScrollToPage((pagerState.currentPage - 1).coerceAtLeast(0)) } }, enabled = pagerState.currentPage > 0) { Icon(Icons.Rounded.ArrowBackIosNew, "Предыдущий") }
                        IconButton(onClick = { scope.launch { pagerState.animateScrollToPage((pagerState.currentPage + 1).coerceAtMost(files.lastIndex)) } }, enabled = pagerState.currentPage < files.lastIndex) { Icon(Icons.AutoMirrored.Rounded.ArrowForwardIos, "Следующий") }
                    }
                }
            }
        }
    }
    if (renaming) RenameFileDialog(item.name, { renaming = false }, onUserActivity) { value -> onRename(item.id, value); renaming = false }
    if (editing) TextFileEditor(repository, item, { editing = false }, onUserActivity) { value -> onSaveText(item.id, value); editing = false }
    if (moving) MoveFileDialog(folders, item.folderId, { moving = false }, onUserActivity) { folderId -> onMove(item.id, folderId); moving = false }
}

@Composable
private fun FilePage(repository: VaultRepository, item: StoredFile, onVideoSwipe: (Int) -> Unit) {
    var bytes by remember(item.id) { mutableStateOf<ByteArray?>(null) }
    var bitmap by remember(item.id) { mutableStateOf<Bitmap?>(null) }
    var text by remember(item.id) { mutableStateOf<String?>(null) }
    var previewError by remember(item.id) { mutableStateOf("") }
    val kind = item.kind()
    val pdf = kind == VaultFileKind.PDF
    LaunchedEffect(item.id) {
        bytes?.fill(0)
        bytes = null
        bitmap = null
        text = null
        previewError = ""
        if (!pdf && item.size <= MAX_MEMORY_PREVIEW_BYTES) {
            val result = withContext(Dispatchers.IO) { runCatching { repository.readFile(item.id) } }
            val loaded = result.getOrElse { previewError = "Не удалось открыть файл"; return@LaunchedEffect }
            bytes = loaded
            bitmap = if (kind == VaultFileKind.IMAGE) decodeSampledBitmap(loaded, 4096) else null
            if (supportsTextDocumentPreview(item) && item.size <= MAX_DOCUMENT_PREVIEW_BYTES) text = withContext(Dispatchers.Default) { runCatching { extractDocumentText(item, loaded) }.getOrNull() }
        }
    }
    DisposableEffect(item.id) { onDispose { bytes?.fill(0); bitmap?.recycle() } }
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        when {
            previewError.isNotEmpty() -> Text(previewError, color = NocturneDanger)
            kind == VaultFileKind.IMAGE && bitmap != null -> Image(bitmap!!.asImageBitmap(), item.name, Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
            kind == VaultFileKind.VIDEO && bytes != null -> Box(Modifier.fillMaxSize().observeHorizontalSwipe(onVideoSwipe)) { MemoryPlayer(bytes!!, item) }
            kind == VaultFileKind.AUDIO && bytes != null -> MemoryPlayer(bytes!!, item)
            pdf -> PdfDocumentPreview(repository, item, Modifier.fillMaxSize())
            text != null -> androidx.compose.foundation.lazy.LazyColumn(Modifier.fillMaxSize().padding(20.dp)) { item { Text(text!!, color = NocturneInk, lineHeight = 21.sp) } }
            else -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(28.dp)) {
                Icon(Icons.AutoMirrored.Rounded.InsertDriveFile, null, Modifier.size(68.dp), tint = NocturneMuted)
                Text(if (item.size > MAX_MEMORY_PREVIEW_BYTES) "Файл слишком большой для внутреннего просмотра." else "Формат не поддерживает внутренний просмотр. Можно сохранить расшифрованную копию.", color = NocturneMuted)
            }
        }
    }
}

private fun Modifier.observeHorizontalSwipe(onSwipe: (Int) -> Unit): Modifier = pointerInput(onSwipe) {
    awaitEachGesture {
        val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
        var lastX = down.position.x
        var distance = 0f
        do {
            val event = awaitPointerEvent(PointerEventPass.Initial)
            val change = event.changes.firstOrNull { it.id == down.id }
            if (change != null) {
                distance += change.position.x - lastX
                lastX = change.position.x
            }
        } while (event.changes.any { it.pressed })
        if (abs(distance) > 72.dp.toPx()) onSwipe(if (distance < 0) 1 else -1)
    }
}

private fun isEditableText(item: StoredFile): Boolean {
    val extension = item.name.substringAfterLast('.', "").lowercase()
    return item.mime.startsWith("text/") || extension in setOf("txt", "md", "json", "xml", "csv", "tsv", "log", "yaml", "yml", "toml", "ini", "conf", "properties", "html", "htm", "css", "scss", "js", "ts", "kt", "java", "py", "c", "cpp", "h", "sh", "ps1", "bat", "sql", "tex", "vtt", "srt", "rtf")
}

private const val MAX_TEXT_PREVIEW_BYTES = 4L * 1024L * 1024L

@Composable
private fun RenameFileDialog(current: String, dismiss: () -> Unit, onUserActivity: () -> Unit, save: (String) -> Unit) {
    var value by remember(current) { mutableStateOf(current) }
    AdaptiveDialog("Переименовать файл", dismiss, onUserActivity, "Сохранить", value.isNotBlank(), onPrimary = { save(value.trim()) }) {
        OutlinedTextField(value, { value = it.take(180) }, label = { Text("Имя файла") }, singleLine = true)
    }
}

@Composable
private fun TextFileEditor(repository: VaultRepository, item: StoredFile, dismiss: () -> Unit, onUserActivity: () -> Unit, save: (String) -> Unit) {
    var value by remember(item.id) { mutableStateOf("") }
    var error by remember(item.id) { mutableStateOf("") }
    LaunchedEffect(item.id) {
        if (item.size > MAX_DOCUMENT_PREVIEW_BYTES) {
            error = "Файл слишком большой для безопасного редактирования"
            return@LaunchedEffect
        }
        val result = withContext(Dispatchers.IO) { runCatching { extractDocumentText(item, repository.readFile(item.id)).orEmpty() } }
        result.onSuccess { value = it }.onFailure { error = "Не удалось открыть файл" }
    }
    Dialog(onDismissRequest = dismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Surface(Modifier.fillMaxSize(), color = NocturneNight) {
            Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().trackUserActivity(onUserActivity)) {
                Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = dismiss) { Icon(Icons.Rounded.Close, "Закрыть") }
                    Text(item.name, Modifier.weight(1f), color = NocturneInk, maxLines = 1)
                    TextButton(onClick = { save(value) }, enabled = error.isEmpty()) { Text("Сохранить") }
                }
                if (error.isNotEmpty()) InlineError(error)
                OutlinedTextField(
                    value = value,
                    onValueChange = { if (it.toByteArray(Charsets.UTF_8).size <= VaultRepository.MAX_TEXT_EDIT_BYTES) value = it },
                    modifier = Modifier.fillMaxSize().padding(12.dp),
                    textStyle = androidx.compose.ui.text.TextStyle(color = NocturneInk, fontSize = 14.sp, lineHeight = 20.sp),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false),
                )
            }
        }
    }
}

@Composable
private fun MoveFileDialog(folders: List<VaultFolder>, current: String, dismiss: () -> Unit, onUserActivity: () -> Unit, move: (String) -> Unit) {
    var selected by remember(current) { mutableStateOf(current) }
    AdaptiveDialog("Переместить файл", dismiss, onUserActivity, "Переместить", onPrimary = { move(selected) }) {
        FolderPicker(folders, "file", selected) { selected = it }
        if (folders.isEmpty()) Text("Папок пока нет. Файл останется без папки.", color = NocturneMuted)
    }
}

private val thumbnailSlots = Semaphore(2, true)
private const val MAX_THUMBNAIL_SOURCE_BYTES = 8L * 1024L * 1024L
private const val MAX_MEMORY_PREVIEW_BYTES = 32L * 1024L * 1024L
private const val MAX_DOCUMENT_PREVIEW_BYTES = 16L * 1024 * 1024
private const val MAX_DECODED_IMAGE_PIXELS = 8_000_000L

@OptIn(UnstableApi::class)
@Composable
private fun MemoryPlayer(bytes: ByteArray, item: StoredFile) {
    val context = LocalContext.current
    var playbackError by remember(item.id) { mutableStateOf("") }
    val player = remember(item.id, bytes) {
        val factory = DefaultMediaSourceFactory { ByteArrayDataSource(bytes) }
        ExoPlayer.Builder(context).setMediaSourceFactory(factory).build().apply {
            setMediaItem(MediaItem.Builder().setUri("memory://${item.id}/${android.net.Uri.encode(item.name)}").setMimeType(resolvedMimeType(item.name, item.mime)).build())
            prepare()
        }
    }
    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) { playbackError = "Кодек этого файла не поддерживается устройством" }
        }
        player.addListener(listener)
        onDispose { player.removeListener(listener); player.release() }
    }
    if (playbackError.isNotEmpty()) {
        Text(playbackError, color = NocturneDanger, modifier = Modifier.padding(24.dp))
    } else if (item.kind() == VaultFileKind.VIDEO) {
        AndroidView({ PlayerView(it).apply { this.player = player; useController = true } }, Modifier.fillMaxSize())
    } else {
        AudioWavePlayer(player, item, Modifier.fillMaxWidth().padding(horizontal = 20.dp))
    }
}

@Composable
private fun AudioWavePlayer(player: ExoPlayer, item: StoredFile, modifier: Modifier = Modifier) {
    var playing by remember(player) { mutableStateOf(player.isPlaying) }
    var position by remember(player) { mutableLongStateOf(0L) }
    var duration by remember(player) { mutableLongStateOf(0L) }
    val bars = remember(item.id) {
        val seed = item.id.hashCode().toLong()
        List(38) { index -> 0.28f + (((seed ushr (index % 24)) + index * 37L) and 0xFF).toFloat() / 255f * 0.72f }
    }
    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) { playing = isPlaying }
            override fun onPlaybackStateChanged(playbackState: Int) {
                duration = player.duration.takeIf { it > 0 } ?: duration
                if (playbackState == Player.STATE_ENDED) position = duration
            }
        }
        player.addListener(listener)
        onDispose { player.removeListener(listener) }
    }
    LaunchedEffect(player, playing) {
        while (true) {
            position = player.currentPosition.coerceAtLeast(0)
            duration = player.duration.takeIf { it > 0 } ?: duration
            delay(if (playing) 150 else 500)
        }
    }
    val progress = if (duration > 0) (position.toFloat() / duration).coerceIn(0f, 1f) else 0f
    Surface(modifier, shape = androidx.compose.foundation.shape.RoundedCornerShape(22.dp), color = NocturneAccentDeep.copy(alpha = 0.72f)) {
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            FilledTonalIconButton(onClick = {
                if (player.playbackState == Player.STATE_ENDED) player.seekTo(0)
                if (player.isPlaying) player.pause() else player.play()
            }) {
                Icon(if (playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow, if (playing) "Пауза" else "Воспроизвести")
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Canvas(
                    Modifier.fillMaxWidth().height(32.dp).pointerInput(player, duration) {
                        detectTapGestures { point -> if (duration > 0) player.seekTo((duration * (point.x / size.width).coerceIn(0f, 1f)).toLong()) }
                    },
                ) {
                    val gap = 2.dp.toPx()
                    val barWidth = ((size.width - gap * (bars.size - 1)) / bars.size).coerceAtLeast(1f)
                    bars.forEachIndexed { index, amplitude ->
                        val barHeight = size.height * amplitude
                        drawRoundRect(
                            color = if (index.toFloat() / bars.size <= progress) NocturneInk else NocturneMuted.copy(alpha = 0.52f),
                            topLeft = androidx.compose.ui.geometry.Offset(index * (barWidth + gap), (size.height - barHeight) / 2f),
                            size = androidx.compose.ui.geometry.Size(barWidth, barHeight),
                            cornerRadius = androidx.compose.ui.geometry.CornerRadius(barWidth / 2f),
                        )
                    }
                }
                Row(Modifier.fillMaxWidth()) {
                    Text("${formatAudioTime(position)} / ${formatAudioTime(duration)}", color = NocturneInk, fontSize = 11.sp)
                    Text(formatAudioSize(item.size), Modifier.weight(1f), color = NocturneMuted, fontSize = 11.sp, textAlign = androidx.compose.ui.text.style.TextAlign.End)
                }
            }
        }
    }
}

internal fun formatAudioTime(value: Long): String {
    val seconds = (value.coerceAtLeast(0) / 1_000).toInt()
    return "${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}"
}

internal fun formatAudioSize(bytes: Long): String = if (bytes < 1024 * 1024) "${(bytes / 1024).coerceAtLeast(1)} КБ" else "${"%.1f".format(bytes / 1024.0 / 1024.0)} МБ"

@Composable
fun AudioAttachmentPlayer(repository: VaultRepository, fileId: String, label: String) {
    var bytes by remember(fileId) { mutableStateOf<ByteArray?>(null) }
    LaunchedEffect(fileId) { bytes = withContext(Dispatchers.IO) { runCatching { repository.readFile(fileId) }.getOrNull() } }
    DisposableEffect(fileId) { onDispose { bytes?.fill(0) } }
    val loaded = bytes
    if (loaded == null) {
        LinearProgressIndicator(Modifier.fillMaxWidth())
    } else {
        MemoryPlayer(loaded, StoredFile(id = fileId, name = label, mime = "audio/mp4", size = loaded.size.toLong(), purpose = StoredFile.PURPOSE_NOTE_AUDIO))
    }
}
