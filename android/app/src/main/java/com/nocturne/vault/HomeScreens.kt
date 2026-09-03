package com.nocturne.vault

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import android.widget.Toast
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items as gridItems
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Android
import androidx.compose.material.icons.rounded.Apps
import androidx.compose.material.icons.rounded.AudioFile
import androidx.compose.material.icons.rounded.AutoDelete
import androidx.compose.material.icons.rounded.Backup
import androidx.compose.material.icons.rounded.BugReport
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.CreateNewFolder
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.DriveFileRenameOutline
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.FileOpen
import androidx.compose.material.icons.rounded.FileDownload
import androidx.compose.material.icons.rounded.FileUpload
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.Image
import androidx.compose.material.icons.rounded.Key
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material.icons.rounded.NoteAlt
import androidx.compose.material.icons.rounded.Password
import androidx.compose.material.icons.rounded.PhotoLibrary
import androidx.compose.material.icons.rounded.PlayCircle
import androidx.compose.material.icons.rounded.Security
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.Timer
import androidx.compose.material.icons.rounded.RestoreFromTrash
import androidx.compose.material.icons.rounded.UploadFile
import androidx.compose.material.icons.rounded.PhotoCamera
import androidx.compose.material.icons.rounded.QrCode2
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.VpnKey
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private enum class Section(val label: String, val icon: ImageVector) {
    PASSWORDS("Пароли", Icons.Rounded.Password),
    PROTECTED("Приложения", Icons.Rounded.Apps),
    NOTES("Заметки", Icons.Rounded.NoteAlt),
    FILES("Файлы", Icons.Rounded.Folder),
    CODES("Коды", Icons.Rounded.VpnKey),
    SETTINGS("Настройки", Icons.Rounded.Settings),
}

@Composable
fun HomeScreen(
    repository: VaultRepository,
    data: VaultData,
    externalRevision: Int,
    importState: ImportUiState,
    onCopy: (String) -> Unit,
    onPickMedia: (String) -> Unit,
    onPickDocuments: (String) -> Unit,
    onPickOtpImage: ((Result<OtpItem>) -> Unit) -> Unit,
    onScanOtpCamera: ((Result<OtpItem>) -> Unit) -> Unit,
    onExport: (StoredFile) -> Unit,
    onLock: () -> Unit,
    onCollapseImport: () -> Unit,
    onClearImport: () -> Unit,
    onSettingsApplied: (PrivacySettings) -> Unit,
    onDataChanged: () -> Unit,
    systemAuthAvailable: Boolean,
    onConfigureSystem: (String, (Result<Unit>) -> Unit) -> Unit,
    onUserActivity: () -> Unit,
    onStartAudio: ((Result<Unit>) -> Unit) -> Unit,
    onStopAudio: ((Result<AudioAttachment>) -> Unit) -> Unit,
    onCancelAudio: () -> Unit,
    onShowOnboarding: () -> Unit,
    autofillEnabled: Boolean,
    onConfigureAutofill: () -> Unit,
    onPickVaultImport: () -> Unit,
    onExportVault: () -> Unit,
    onBeginProtectedProvisioning: () -> Unit,
    onFinishProtectedProvisioning: () -> Unit,
) {
    var section by remember { mutableStateOf(Section.PASSWORDS) }
    externalRevision.hashCode()

    Scaffold(
        containerColor = androidx.compose.ui.graphics.Color.Transparent,
        contentColor = NocturneInk,
        bottomBar = {
            NavigationBar(containerColor = NocturnePanelStrong) {
                Section.entries.forEach { item ->
                    NavigationBarItem(
                        selected = section == item,
                        onClick = { section = item },
                        icon = { Icon(item.icon, item.label) },
                        label = { Text(item.label, fontSize = 10.sp) },
                    )
                }
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding).trackUserActivity(onUserActivity)) {
            when (section) {
                    Section.PASSWORDS -> PasswordsScreen(repository, data, onCopy, onLock, onUserActivity, onDataChanged)
                    Section.NOTES -> NotesScreen(repository, data, onLock, onUserActivity, onDataChanged, onStartAudio, onStopAudio, onCancelAudio)
                    Section.FILES -> FilesScreen(repository, data, onPickMedia, onPickDocuments, onExport, onLock, onUserActivity, onDataChanged)
                    Section.CODES -> CodesScreen(data, onCopy, onLock, { repository.saveOtp(it); onDataChanged() }, { repository.deleteOtp(it); onDataChanged() }, onPickOtpImage, onScanOtpCamera)
                    Section.PROTECTED -> ProtectedSpaceScreen(repository, onLock, onBeginProtectedProvisioning, onFinishProtectedProvisioning)
                    Section.SETTINGS -> SettingsScreen(repository, data, onLock, onSettingsApplied, systemAuthAvailable, onConfigureSystem, onDataChanged, onUserActivity, onShowOnboarding, autofillEnabled, onConfigureAutofill, onPickVaultImport, onExportVault)
            }
            if (importState.items.isNotEmpty()) {
                ImportProgressCard(importState, onCollapseImport, onClearImport, Modifier.align(Alignment.BottomCenter).padding(12.dp))
            }
        }
    }
}

@Composable
internal fun ScreenShell(
    title: String,
    subtitle: String,
    count: Int? = null,
    actionIcon: ImageVector? = null,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
    secondaryActionIcon: ImageVector? = null,
    secondaryActionLabel: String? = null,
    onSecondaryAction: (() -> Unit)? = null,
    onLock: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(Modifier.fillMaxSize().padding(horizontal = 18.dp)) {
        Spacer(Modifier.height(18.dp))
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(title, color = NocturneInk, fontSize = 30.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.8).sp)
                    if (count != null) Text(count.toString(), color = NocturneMuted, fontSize = 13.sp)
                }
                Text(subtitle, color = NocturneMuted, fontSize = 12.sp)
            }
            if (actionIcon != null && actionLabel != null && onAction != null) {
                FilledTonalIconButton(onClick = onAction) { Icon(actionIcon, actionLabel) }
            }
            if (secondaryActionIcon != null && secondaryActionLabel != null && onSecondaryAction != null) {
                Spacer(Modifier.width(6.dp))
                FilledTonalIconButton(onClick = onSecondaryAction) { Icon(secondaryActionIcon, secondaryActionLabel) }
            }
            Spacer(Modifier.width(6.dp))
            FilledTonalIconButton(onClick = onLock) { Icon(Icons.Rounded.Lock, "Заблокировать") }
        }
        Spacer(Modifier.height(18.dp))
        content()
    }
}

@Composable
private fun EmptyState(icon: ImageVector, title: String, copy: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(9.dp), modifier = Modifier.padding(32.dp)) {
            Icon(icon, null, Modifier.size(48.dp), tint = NocturneAccent)
            Text(title, color = NocturneInk, fontWeight = FontWeight.SemiBold, fontSize = 18.sp)
            Text(copy, color = NocturneMuted, fontSize = 13.sp, lineHeight = 19.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
    }
}

@Composable
private fun PasswordsScreen(repository: VaultRepository, data: VaultData, copy: (String) -> Unit, onLock: () -> Unit, onUserActivity: () -> Unit, changed: () -> Unit) {
    var editor by remember { mutableStateOf<PasswordItem?>(null) }
    var creating by remember { mutableStateOf(false) }
    var currentFolder by remember { mutableStateOf("") }
    var creatingFolder by remember { mutableStateOf(false) }
    var selectedFolderIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    var renamingFolderId by remember { mutableStateOf<String?>(null) }
    var deletingFolder by remember { mutableStateOf(false) }
    val folders = data.folders.filter { it.kind == "password" && it.parentId == currentFolder }
    val records = data.passwords.filter { it.folderId == currentFolder }
    ScreenShell("Пароли", "Защищённые учётные записи", data.passwords.size, Icons.Rounded.Add, "Добавить", { creating = true }, Icons.Rounded.CreateNewFolder, "Новая папка", { creatingFolder = true }, onLock) {
        FolderPath(data.folders, currentFolder) { currentFolder = it; selectedFolderIds = emptySet() }
        if (folders.isEmpty() && records.isEmpty()) EmptyState(Icons.Rounded.Key, "Здесь пока пусто", "Добавьте учётную запись или создайте папку.")
        else LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
            items(folders, key = { "folder:${it.id}" }) { folder ->
                val chosen = folder.id in selectedFolderIds
                FolderCard(
                    folder = folder,
                    selected = chosen,
                    selectionCount = selectedFolderIds.size,
                    onOpen = { if (selectedFolderIds.isEmpty()) currentFolder = folder.id else selectedFolderIds = if (chosen) selectedFolderIds - folder.id else selectedFolderIds + folder.id },
                    onLongPress = { selectedFolderIds = if (chosen) selectedFolderIds - folder.id else selectedFolderIds + folder.id },
                    onRename = { renamingFolderId = folder.id },
                    onDeleteSelection = { deletingFolder = true },
                    onDeselect = { selectedFolderIds -= folder.id },
                )
            }
            items(records, key = { it.id }) { item ->
                GlassCard(Modifier.fillMaxWidth().clickable { editor = item }) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(item.title, color = NocturneInk, fontWeight = FontWeight.SemiBold)
                        Text(item.username.ifBlank { "Логин не указан" }, color = NocturneMuted, fontSize = 12.sp)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (item.username.isNotBlank()) MiniAction(Icons.Rounded.ContentCopy, "Логин") { copy(item.username) }
                            MiniAction(Icons.Rounded.Key, "Пароль") { copy(item.password) }
                            if (item.url.isNotBlank()) MiniAction(Icons.Rounded.FileOpen, "URL") { copy(item.url) }
                        }
                    }
                }
            }
        }
    }
    if (creating || editor != null) PasswordEditor(editor, data.folders, currentFolder, onUserActivity, { creating = false; editor = null }, { repository.savePassword(it); changed(); creating = false; editor = null }, { repository.deletePassword(it); changed(); creating = false; editor = null })
    if (creatingFolder) CreateFolderDialog("password", currentFolder, { creatingFolder = false }, onUserActivity) { repository.saveFolder(it); changed(); creatingFolder = false }
    renamingFolderId?.let { id -> data.folders.firstOrNull { it.id == id }?.let { folder -> RenameFolderDialog(folder, { renamingFolderId = null }, onUserActivity) { repository.saveFolder(it); changed(); renamingFolderId = null; selectedFolderIds = emptySet() } } }
    if (deletingFolder) DeleteFolderDialog(data.folders.filter { it.id in selectedFolderIds }, { deletingFolder = false }, onUserActivity) { repository.deleteFolders(selectedFolderIds); changed(); deletingFolder = false; selectedFolderIds = emptySet() }
}

@Composable
private fun NotesScreen(
    repository: VaultRepository,
    data: VaultData,
    onLock: () -> Unit,
    onUserActivity: () -> Unit,
    changed: () -> Unit,
    startAudio: ((Result<Unit>) -> Unit) -> Unit,
    stopAudio: ((Result<AudioAttachment>) -> Unit) -> Unit,
    cancelAudio: () -> Unit,
) {
    var editor by remember { mutableStateOf<NoteItem?>(null) }
    var creating by remember { mutableStateOf(false) }
    var currentFolder by remember { mutableStateOf("") }
    var creatingFolder by remember { mutableStateOf(false) }
    var selectedFolderIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    var renamingFolderId by remember { mutableStateOf<String?>(null) }
    var deletingFolder by remember { mutableStateOf(false) }
    val folders = data.folders.filter { it.kind == "note" && it.parentId == currentFolder }
    val notes = data.notes.filter { it.folderId == currentFolder }
    ScreenShell("Заметки", "Текст и аудиозаписи внутри контейнера", data.notes.size, Icons.Rounded.Add, "Создать", { creating = true }, Icons.Rounded.CreateNewFolder, "Новая папка", { creatingFolder = true }, onLock) {
        FolderPath(data.folders, currentFolder) { currentFolder = it; selectedFolderIds = emptySet() }
        if (folders.isEmpty() && notes.isEmpty()) EmptyState(Icons.Rounded.NoteAlt, "Здесь пока пусто", "Создайте текстовую или аудиозаметку либо добавьте папку.")
        else LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(folders, key = { "folder:${it.id}" }) { folder ->
                val chosen = folder.id in selectedFolderIds
                FolderCard(
                    folder = folder,
                    selected = chosen,
                    selectionCount = selectedFolderIds.size,
                    onOpen = { if (selectedFolderIds.isEmpty()) currentFolder = folder.id else selectedFolderIds = if (chosen) selectedFolderIds - folder.id else selectedFolderIds + folder.id },
                    onLongPress = { selectedFolderIds = if (chosen) selectedFolderIds - folder.id else selectedFolderIds + folder.id },
                    onRename = { renamingFolderId = folder.id },
                    onDeleteSelection = { deletingFolder = true },
                    onDeselect = { selectedFolderIds -= folder.id },
                )
            }
            items(notes, key = { it.id }) { item ->
                GlassCard(Modifier.fillMaxWidth().clickable { editor = item }) { Column(Modifier.padding(16.dp)) { Text(item.title, color = NocturneInk, fontWeight = FontWeight.SemiBold); Spacer(Modifier.height(5.dp)); Text(if (item.audioFileId.isNotBlank()) "Аудиозаметка${if (item.body.isNotBlank()) " · ${item.body}" else ""}" else item.body, color = NocturneMuted, maxLines = 4, overflow = TextOverflow.Ellipsis) } }
            }
        }
    }
    if (creating || editor != null) NoteEditor(
        item = editor,
        folders = data.folders,
        initialFolder = currentFolder,
        repository = repository,
        onUserActivity = onUserActivity,
        startAudio = startAudio,
        stopAudio = stopAudio,
        cancelAudio = cancelAudio,
        dismiss = { creating = false; editor = null },
        save = { repository.saveNote(it); changed(); creating = false; editor = null },
        delete = { repository.deleteNote(it); changed(); creating = false; editor = null },
    )
    if (creatingFolder) CreateFolderDialog("note", currentFolder, { creatingFolder = false }, onUserActivity) { repository.saveFolder(it); changed(); creatingFolder = false }
    renamingFolderId?.let { id -> data.folders.firstOrNull { it.id == id }?.let { folder -> RenameFolderDialog(folder, { renamingFolderId = null }, onUserActivity) { repository.saveFolder(it); changed(); renamingFolderId = null; selectedFolderIds = emptySet() } } }
    if (deletingFolder) DeleteFolderDialog(data.folders.filter { it.id in selectedFolderIds }, { deletingFolder = false }, onUserActivity) { repository.deleteFolders(selectedFolderIds); changed(); deletingFolder = false; selectedFolderIds = emptySet() }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FilesScreen(
    repository: VaultRepository,
    data: VaultData,
    pickMedia: (String) -> Unit,
    pickDocuments: (String) -> Unit,
    export: (StoredFile) -> Unit,
    onLock: () -> Unit,
    onUserActivity: () -> Unit,
    changed: () -> Unit,
) {
    var importSheet by remember { mutableStateOf(false) }
    var viewer by remember { mutableStateOf<String?>(null) }
    var currentFolder by remember { mutableStateOf("") }
    var creatingFolder by remember { mutableStateOf(false) }
    var search by remember { mutableStateOf("") }
    var filter by remember { mutableStateOf("all") }
    var columns by remember { mutableIntStateOf(3) }
    var zoomAccumulator by remember { mutableFloatStateOf(1f) }
    var selected by remember { mutableStateOf<Set<String>>(emptySet()) }
    var selectedFolderIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    var renamingFolderId by remember { mutableStateOf<String?>(null) }
    var deletingFolder by remember { mutableStateOf(false) }
    val folders = data.folders.filter { it.kind == "file" && it.parentId == currentFolder && (search.isBlank() || it.name.contains(search, true)) }
    val libraryFiles = data.files.filter { it.purpose == StoredFile.PURPOSE_LIBRARY && it.folderId == currentFolder }
    val visible = libraryFiles.filter { item ->
        (search.isBlank() || item.name.contains(search, true)) && when (filter) {
            "image" -> item.kind() == VaultFileKind.IMAGE
            "video" -> item.kind() == VaultFileKind.VIDEO
            "audio" -> item.kind() == VaultFileKind.AUDIO
            "document" -> item.kind() in setOf(VaultFileKind.PDF, VaultFileKind.DOCUMENT, VaultFileKind.OTHER)
            else -> true
        }
    }
    ScreenShell("Файлы", "Единая защищённая галерея", data.files.count { it.purpose == StoredFile.PURPOSE_LIBRARY }, Icons.Rounded.UploadFile, "Импорт", { importSheet = true }, Icons.Rounded.CreateNewFolder, "Новая папка", { creatingFolder = true }, onLock) {
        FolderPath(data.folders, currentFolder) { currentFolder = it; selected = emptySet(); selectedFolderIds = emptySet() }
        OutlinedTextField(
            value = search,
            onValueChange = { search = it.take(100); selected = emptySet() },
            modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
            singleLine = true,
            shape = RoundedCornerShape(18.dp),
            label = { Text("Поиск по файлам") },
            leadingIcon = { Icon(Icons.Rounded.Search, null) },
        )
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            listOf("all" to "Все", "image" to "Фото", "video" to "Видео", "audio" to "Аудио", "document" to "Документы").forEach { (key, label) ->
                FilterChip(filter == key, { filter = key; selected = emptySet() }, { Text(label) })
            }
        }
        if (selected.isNotEmpty()) {
            GlassCard(Modifier.fillMaxWidth().padding(bottom = 8.dp), strong = true) {
                Row(Modifier.padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Выбрано: ${selected.size}", Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
                    TextButton(onClick = { repository.deleteFiles(selected); changed(); selected = emptySet() }) { Text("Удалить", color = NocturneDanger) }
                    TextButton(onClick = { selected = emptySet() }) { Text("Отмена") }
                }
            }
        }
        if (folders.isEmpty() && visible.isEmpty()) EmptyState(Icons.Rounded.PhotoLibrary, "Здесь пока пусто", "Импортируйте фото, видео, аудио или документы. Оригиналы останутся на прежнем месте.")
        else LazyVerticalGrid(
            columns = GridCells.Fixed(columns),
            modifier = Modifier.fillMaxSize().pointerInput(columns) {
                detectTransformGestures { _, _, zoom, _ ->
                    zoomAccumulator *= zoom
                    if (zoomAccumulator > 1.16f && columns > 2) { columns--; zoomAccumulator = 1f }
                    else if (zoomAccumulator < 0.86f && columns < 6) { columns++; zoomAccumulator = 1f }
                }
            },
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
            contentPadding = PaddingValues(bottom = 24.dp),
        ) {
            gridItems(folders, key = { "folder:${it.id}" }) { folder ->
                val folderChosen = folder.id in selectedFolderIds
                GlassCard(Modifier.fillMaxWidth().aspectRatio(1f).combinedClickable(
                    onClick = { if (selectedFolderIds.isEmpty()) currentFolder = folder.id else selectedFolderIds = if (folderChosen) selectedFolderIds - folder.id else selectedFolderIds + folder.id },
                    onLongClick = { selected = emptySet(); selectedFolderIds = if (folderChosen) selectedFolderIds - folder.id else selectedFolderIds + folder.id },
                ), strong = folderChosen) {
                    Column(Modifier.fillMaxSize().padding(10.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(if (folderChosen) Icons.Rounded.CheckCircle else Icons.Rounded.Folder, null, Modifier.size(if (columns <= 3) 44.dp else 30.dp), tint = NocturneAccent)
                        Text(folder.name, color = NocturneInk, fontSize = if (columns <= 3) 12.sp else 9.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        if (folderChosen) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
                            val actionSize = if (columns <= 3) 36.dp else 28.dp
                            val iconSize = if (columns <= 3) 18.dp else 14.dp
                            if (selectedFolderIds.size == 1) IconButton(onClick = { renamingFolderId = folder.id }, Modifier.size(actionSize)) { Icon(Icons.Rounded.DriveFileRenameOutline, "Переименовать", Modifier.size(iconSize)) }
                            IconButton(onClick = { deletingFolder = true }, Modifier.size(actionSize)) { Icon(Icons.Rounded.Delete, "Удалить выбранные папки", Modifier.size(iconSize), tint = NocturneDanger) }
                            IconButton(onClick = { selectedFolderIds -= folder.id }, Modifier.size(actionSize)) { Icon(Icons.Rounded.Close, "Снять выделение", Modifier.size(iconSize)) }
                        }
                    }
                }
            }
            gridItems(visible, key = { it.id }) { item ->
                val chosen = item.id in selected
                Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(if (columns <= 3) 16.dp else 8.dp)).combinedClickable(
                    onClick = { if (selected.isEmpty()) viewer = item.id else selected = if (chosen) selected - item.id else selected + item.id },
                    onLongClick = { selected = if (chosen) selected - item.id else selected + item.id },
                )) {
                    if (item.kind() in setOf(VaultFileKind.IMAGE, VaultFileKind.VIDEO)) MediaThumbnail(repository, item, Modifier.fillMaxSize(), crop = true)
                    else Box(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color(0xFF171820)), contentAlignment = Alignment.Center) { FileTypeBadge(item) }
                    if (item.kind() == VaultFileKind.VIDEO) Icon(Icons.Rounded.PlayCircle, "Видео", Modifier.align(Alignment.Center).size(if (columns <= 3) 40.dp else 26.dp), tint = NocturneInk)
                    if (columns <= 4) Text(item.name, Modifier.align(Alignment.BottomStart).fillMaxWidth().background(androidx.compose.ui.graphics.Color(0xB3090A0D)).padding(6.dp), color = NocturneInk, fontSize = if (columns <= 3) 10.sp else 8.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (chosen) Box(Modifier.fillMaxSize().background(NocturneAccentDeep.copy(alpha = 0.28f))) { Icon(Icons.Rounded.CheckCircle, "Выбрано", Modifier.align(Alignment.TopEnd).padding(7.dp), tint = NocturneAccent) }
                }
            }
        }
    }
    if (importSheet) ModalBottomSheet(onDismissRequest = { importSheet = false }, containerColor = NocturnePanelStrong) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Что импортировать", fontSize = 24.sp, fontWeight = FontWeight.SemiBold)
            Text("Можно выбрать сразу несколько файлов. После выбора Nocturne покажет очередь и прогресс шифрования.", color = NocturneMuted)
            ImportChoice(Icons.Rounded.PhotoLibrary, "Фото и видео", "Можно выбрать сразу несколько") { importSheet = false; pickMedia(currentFolder) }
            ImportChoice(Icons.Rounded.Description, "Документы и аудио", "PDF, офисные файлы, записи и музыка") { importSheet = false; pickDocuments(currentFolder) }
            Spacer(Modifier.height(24.dp))
        }
    }
    viewer?.let { FileViewer(repository, visible, it, { viewer = null }, export, { id -> repository.deleteFile(id); changed(); viewer = null }, { id, name -> repository.renameFile(id, name); changed() }, { id, text -> repository.replaceTextFile(id, text); changed() }, data.folders.filter { it.kind == "file" }, { id, folderId -> repository.moveFile(id, folderId); changed() }, onUserActivity) }
    if (creatingFolder) CreateFolderDialog("file", currentFolder, { creatingFolder = false }, onUserActivity) { repository.saveFolder(it); changed(); creatingFolder = false }
    renamingFolderId?.let { id -> data.folders.firstOrNull { it.id == id }?.let { folder -> RenameFolderDialog(folder, { renamingFolderId = null }, onUserActivity) { repository.saveFolder(it); changed(); renamingFolderId = null; selectedFolderIds = emptySet() } } }
    if (deletingFolder) DeleteFolderDialog(data.folders.filter { it.id in selectedFolderIds }, { deletingFolder = false }, onUserActivity) { repository.deleteFolders(selectedFolderIds); changed(); deletingFolder = false; selectedFolderIds = emptySet() }
}

@Composable
private fun FileTypeBadge(item: StoredFile) {
    val extension = item.name.substringAfterLast('.', "FILE").uppercase().take(5)
    Box(Modifier.size(52.dp).clip(RoundedCornerShape(16.dp)).background(androidx.compose.ui.graphics.Color(0x267D69D9)), contentAlignment = Alignment.Center) {
        Text(extension, color = NocturneAccent, fontSize = 10.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun ImportChoice(icon: ImageVector, title: String, subtitle: String, action: () -> Unit) {
    GlassCard(Modifier.fillMaxWidth().clickable(onClick = action)) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Icon(icon, null, Modifier.size(28.dp), tint = NocturneAccent)
            Column { Text(title, fontWeight = FontWeight.SemiBold); Text(subtitle, color = NocturneMuted, fontSize = 12.sp) }
        }
    }
}

@Composable
private fun CodesScreen(data: VaultData, copy: (String) -> Unit, onLock: () -> Unit, save: (OtpItem) -> Unit, delete: (String) -> Unit, pickImage: ((Result<OtpItem>) -> Unit) -> Unit, scanCamera: ((Result<OtpItem>) -> Unit) -> Unit) {
    var creating by remember { mutableStateOf(false) }
    var editor by remember { mutableStateOf<OtpItem?>(null) }
    var tick by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) { while (true) { delay(1_000); tick++ } }
    ScreenShell("Коды", "Одноразовые TOTP-коды", data.otp.size, Icons.Rounded.Add, "Добавить", { creating = true }, onLock = onLock) {
        if (data.otp.isEmpty()) EmptyState(Icons.Rounded.Security, "Кодов пока нет", "Добавьте код по QR-камере, изображению или секретному ключу.")
        else LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(data.otp, key = { it.id }) { item ->
                val code = runCatching { Totp.code(item.secret) }.getOrDefault("------")
                GlassCard(Modifier.fillMaxWidth().clickable { editor = item }) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                        Text(item.issuer.ifBlank { item.account }, color = NocturneInk, fontWeight = FontWeight.SemiBold)
                        Text(item.account, color = NocturneMuted, fontSize = 12.sp)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(code.chunked(3).joinToString(" "), color = NocturneInk, fontFamily = FontFamily.Monospace, fontSize = 28.sp, letterSpacing = 2.sp, fontWeight = FontWeight.SemiBold)
                            Spacer(Modifier.weight(1f))
                            Text("${Totp.remaining()}с", color = NocturneAccent, fontSize = 12.sp)
                            IconButton(onClick = { copy(code) }) { Icon(Icons.Rounded.ContentCopy, "Копировать") }
                        }
                        LinearProgressIndicator(progress = { Totp.remaining() / 30f }, Modifier.fillMaxWidth())
                    }
                }
            }
        }
    }
    tick.hashCode()
    if (creating || editor != null) OtpEditor(editor, { creating = false; editor = null }, { save(it); creating = false; editor = null }, { delete(it); creating = false; editor = null }, pickImage, scanCamera)
}

@Composable
private fun SettingsScreen(
    repository: VaultRepository,
    data: VaultData,
    onLock: () -> Unit,
    apply: (PrivacySettings) -> Unit,
    systemAuthAvailable: Boolean,
    configureSystem: (String, (Result<Unit>) -> Unit) -> Unit,
    changed: () -> Unit,
    onUserActivity: () -> Unit,
    showOnboarding: () -> Unit,
    autofillEnabled: Boolean,
    configureAutofill: () -> Unit,
    pickVaultImport: () -> Unit,
    exportVault: () -> Unit,
) {
    val context = LocalContext.current
    var quickDialog by remember { mutableStateOf(false) }
    var masterDialog by remember { mutableStateOf(false) }
    var trashDialog by remember { mutableStateOf(false) }
    var backupDialog by remember { mutableStateOf(false) }
    var exportDialog by remember { mutableStateOf(false) }
    var importDialog by remember { mutableStateOf(false) }
    var diagnosticsEnabled by remember { mutableStateOf(SafeDebugLog.isEnabled(context)) }
    fun update(value: PrivacySettings) { repository.updateSettings(value); apply(value); changed() }
    val settings = data.settings
    ScreenShell("Настройки", "Приватность и блокировка", onLock = onLock) {
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(bottom = 18.dp)) {
            item { SettingsGroupTitle("Доступ") }
            item { SettingsAction(Icons.Rounded.Key, "Быстрый вход", quickModeName(repository.quickMode()), "Изменить") { quickDialog = true } }
            item { SettingsAction(Icons.Rounded.Shield, "Мастер-пароль", "Потребуется текущий мастер-пароль", "Сменить") { masterDialog = true } }
            item { SettingsStatusAction(Icons.Rounded.Password, "Автозаполнение Android", if (autofillEnabled) "Подключено" else "Не подключено", configureAutofill) }
            item { SettingsChoice(Icons.Rounded.Timer, "Автоблокировка", autoLockLabel(settings.autoLockSeconds), PrivacySettings.ALLOWED_AUTO_LOCK.toList().sorted(), { autoLockLabel(it) }) { update(settings.copy(autoLockSeconds = it)) } }
            item { SettingsGroupTitle("Экран и ввод") }
            item { SettingsToggle(Icons.Rounded.Image, "Разрешить скриншоты", "По умолчанию снимки и превью недавних приложений заблокированы", settings.allowScreenshots) { update(settings.copy(allowScreenshots = it)) } }
            item { SettingsToggle(Icons.Rounded.Security, "Приватный режим клавиатуры", "Запрещает обучение на введённом тексте. Поддерживаемая клавиатура покажет значок инкогнито.", settings.anonymousKeyboard) { update(settings.copy(anonymousKeyboard = it)) } }
            item { SettingsToggle(Icons.Rounded.VpnKey, "Скрывать рисунок", "Не показывать линии и выбранные точки во время ввода ключа", settings.hidePatternTrace) { update(settings.copy(hidePatternTrace = it)) } }
            item { SettingsGroupTitle("Буфер обмена") }
            item { SettingsChoice(Icons.Rounded.Timer, "Автоочистка буфера", clipboardLabel(settings.clipboardClearSeconds), PrivacySettings.ALLOWED_CLIPBOARD_TIMEOUTS.toList().sorted(), { clipboardLabel(it) }) { update(settings.copy(clipboardClearSeconds = it)) } }
            item { SettingsGroupTitle("Данные") }
            item { SettingsAction(Icons.Rounded.Backup, "Бэкап", "Экспорт или импорт хранилища", "Открыть") { backupDialog = true } }
            item { SettingsAction(Icons.Rounded.RestoreFromTrash, "Корзина", if (data.trashCount == 0) "Корзина пуста" else "Объектов: ${data.trashCount}", "Открыть") { trashDialog = true } }
            item { SettingsGroupTitle("Диагностика") }
            item {
                SettingsToggle(
                    Icons.Rounded.BugReport,
                    "Диагностический режим",
                    "Записывает только технические события и коды ошибок. Пароли, заметки, файлы и содержимое хранилища в журнал не попадают.",
                    diagnosticsEnabled,
                ) { enabled ->
                    SafeDebugLog.setEnabled(context, enabled)
                    diagnosticsEnabled = enabled
                }
            }
            item {
                SettingsAction(
                    Icons.Rounded.ContentCopy,
                    "Скопировать журнал",
                    if (diagnosticsEnabled) "Можно отправить разработчику после повторения ошибки" else "Сначала включите диагностический режим",
                    if (diagnosticsEnabled) "Копировать" else "Выключен",
                ) {
                    if (!diagnosticsEnabled) {
                        Toast.makeText(context, "Сначала включите диагностический режим", Toast.LENGTH_SHORT).show()
                    } else {
                        SafeDebugLog.record(context, "diagnostics.copied")
                        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                        clipboard.setPrimaryClip(ClipData.newPlainText("Nocturne diagnostics", SafeDebugLog.report(context)))
                        Toast.makeText(context, "Диагностический журнал скопирован", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }
        Text(
            "Nocturne • версия ${BuildConfig.VERSION_NAME}",
            color = NocturneMuted,
            fontSize = 11.sp,
            modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 8.dp, bottom = 8.dp),
        )
    }
    if (quickDialog) QuickSetupDialog(repository, systemAuthAvailable, configureSystem, settings.hidePatternTrace, onUserActivity) { quickDialog = false; changed() }
    if (masterDialog) ChangeMasterDialog(repository, onUserActivity) { masterDialog = false }
    if (trashDialog) TrashDialog(repository, data, { trashDialog = false }, changed, onUserActivity)
    if (backupDialog) BackupChoiceDialog(
        dismiss = { backupDialog = false },
        onUserActivity = onUserActivity,
        export = { backupDialog = false; exportDialog = true },
        import = { backupDialog = false; importDialog = true },
    )
    if (exportDialog) VaultExportDialog(repository, { exportDialog = false }, onUserActivity) { exportDialog = false; exportVault() }
    if (importDialog) AdaptiveDialog(
        title = "Импортировать хранилище?",
        onDismiss = { importDialog = false },
        onUserActivity = onUserActivity,
        primaryLabel = "Выбрать копию",
        onPrimary = { importDialog = false; pickVaultImport() },
    ) {
        Text("После ввода мастер-пароля копии текущее хранилище будет полностью заменено. До завершения проверки текущие данные останутся без изменений.", color = NocturneMuted, lineHeight = 19.sp)
    }
}

@Composable
internal fun BackupChoiceDialog(
    dismiss: () -> Unit,
    onUserActivity: () -> Unit,
    export: () -> Unit,
    import: () -> Unit,
) {
    AdaptiveDialog(
        title = "Бэкап",
        onDismiss = dismiss,
        onUserActivity = onUserActivity,
    ) {
        OutlinedButton(
            onClick = export,
            modifier = Modifier.fillMaxWidth().height(56.dp),
            shape = RoundedCornerShape(18.dp),
        ) {
            Icon(Icons.Rounded.FileUpload, null)
            Spacer(Modifier.width(10.dp))
            Text("Экспорт", fontWeight = FontWeight.SemiBold)
        }
        OutlinedButton(
            onClick = import,
            modifier = Modifier.fillMaxWidth().height(56.dp),
            shape = RoundedCornerShape(18.dp),
        ) {
            Icon(Icons.Rounded.FileDownload, null)
            Spacer(Modifier.width(10.dp))
            Text("Импорт", fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun VaultExportDialog(repository: VaultRepository, dismiss: () -> Unit, onUserActivity: () -> Unit, export: () -> Unit) {
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    AdaptiveDialog(
        title = "Экспорт хранилища",
        onDismiss = dismiss,
        onUserActivity = onUserActivity,
        primaryLabel = "Продолжить",
        primaryEnabled = password.isNotBlank(),
        primaryLoading = loading,
        onPrimary = {
            loading = true
            val secret = password.toCharArray()
            password = ""
            scope.launch {
                val verified = withContext(Dispatchers.Default) { repository.verifyMasterPassword(secret) }
                loading = false
                if (verified) export() else error = "Неверный мастер-пароль"
            }
        },
    ) {
        Text("Копия уже зашифрована мастер-паролем. Подтвердите его перед сохранением файла.", color = NocturneMuted)
        SecretTextField("Текущий мастер-пароль", password, { password = it; error = "" })
        InlineError(error)
    }
}

@Composable
private fun SettingsStatusAction(icon: ImageVector, title: String, status: String, action: () -> Unit) {
    GlassCard(Modifier.fillMaxWidth().clickable(onClick = action)) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(icon, null, tint = NocturneAccent)
            Text(title, Modifier.weight(1f), color = NocturneInk, fontWeight = FontWeight.SemiBold)
            Text(status, color = NocturneAccent, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable private fun SettingsGroupTitle(value: String) { Text(value.uppercase(), color = NocturneAccent, fontSize = 11.sp, letterSpacing = 1.2.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp, start = 4.dp)) }

@Composable
private fun SettingsAction(icon: ImageVector, title: String, subtitle: String, actionLabel: String, action: () -> Unit) {
    GlassCard(Modifier.fillMaxWidth().clickable(onClick = action)) { Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Icon(icon, null, tint = NocturneAccent); Column(Modifier.weight(1f)) { Text(title, color = NocturneInk, fontWeight = FontWeight.SemiBold); Text(subtitle, color = NocturneMuted, fontSize = 12.sp) }; Text(actionLabel, color = NocturneAccent, fontWeight = FontWeight.SemiBold)
    } }
}

@Composable
private fun SettingsToggle(icon: ImageVector, title: String, subtitle: String, checked: Boolean, changed: (Boolean) -> Unit) {
    GlassCard(Modifier.fillMaxWidth()) { Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Icon(icon, null, tint = NocturneAccent); Column(Modifier.weight(1f).clickable { changed(!checked) }) { Text(title, color = NocturneInk, fontWeight = FontWeight.SemiBold); Text(subtitle, color = NocturneMuted, fontSize = 12.sp, lineHeight = 17.sp) }; Switch(checked, changed)
    } }
}

@Composable
private fun SettingsChoice(icon: ImageVector, title: String, current: String, values: List<Int>, label: (Int) -> String, changed: (Int) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    GlassCard(Modifier.fillMaxWidth().clickable { expanded = !expanded }) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) { Icon(icon, null, tint = NocturneAccent); Column { Text(title, color = NocturneInk, fontWeight = FontWeight.SemiBold); Text(current, color = NocturneMuted, fontSize = 12.sp) } }
            if (expanded) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    values.chunked(3).forEach { row -> Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) { row.forEach { value -> FilterChip(selected = label(value) == current, onClick = { changed(value); expanded = false }, label = { Text(label(value), fontSize = 11.sp) }) } } }
                }
            }
        }
    }
}

@Composable
private fun MiniAction(icon: ImageVector, label: String, danger: Boolean = false, action: () -> Unit) {
    OutlinedButton(onClick = action, contentPadding = PaddingValues(horizontal = 10.dp), modifier = Modifier.height(36.dp)) {
        Icon(icon, null, Modifier.size(16.dp), tint = if (danger) NocturneDanger else NocturneInk); Spacer(Modifier.width(5.dp)); Text(label, color = if (danger) NocturneDanger else NocturneInk, fontSize = 11.sp)
    }
}

@Composable
private fun ImportProgressCard(state: ImportUiState, collapse: () -> Unit, clear: () -> Unit, modifier: Modifier) {
    GlassCard(modifier.fillMaxWidth(), strong = true) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(if (state.active) Icons.Rounded.UploadFile else Icons.Rounded.Security, null, tint = NocturneAccent)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) { Text(if (state.active) "Шифрование файлов" else "Импорт завершён", fontWeight = FontWeight.SemiBold); Text("${state.completedCount} из ${state.items.size}", color = NocturneMuted, fontSize = 11.sp) }
                TextButton(onClick = if (state.active) collapse else clear) { Text(if (state.active) if (state.collapsed) "Показать" else "Скрыть" else "Готово") }
            }
            LinearProgressIndicator(progress = { state.overallProgress }, Modifier.fillMaxWidth())
            if (!state.collapsed) state.items.takeLast(4).forEach { item ->
                Row { Text(item.name, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 12.sp); Text(importStageLabel(item), color = if (item.stage == ImportStage.FAILED) NocturneDanger else NocturneMuted, fontSize = 11.sp) }
            }
        }
    }
}

@Composable
private fun PasswordEditor(item: PasswordItem?, folders: List<VaultFolder>, initialFolder: String, onUserActivity: () -> Unit, dismiss: () -> Unit, save: (PasswordItem) -> Unit, delete: (String) -> Unit) {
    var title by remember(item?.id) { mutableStateOf(item?.title.orEmpty()) }; var username by remember(item?.id) { mutableStateOf(item?.username.orEmpty()) }; var password by remember(item?.id) { mutableStateOf(item?.password.orEmpty()) }; var url by remember(item?.id) { mutableStateOf(item?.url.orEmpty()) }; var folderId by remember(item?.id) { mutableStateOf(item?.folderId ?: initialFolder) }
    FormDialog(if (item == null) "Новая запись" else "Изменить запись", dismiss, title.isNotBlank() && password.isNotBlank(), { save(PasswordItem(id = item?.id ?: java.util.UUID.randomUUID().toString(), title = title.trim(), username = username.trim(), password = password, url = url.trim(), folderId = folderId)) }, onUserActivity, dangerLabel = if (item == null) null else "Переместить в корзину", onDanger = item?.let { { delete(it.id) } }) {
        PrivateTextField("Название", title, { title = it }); PrivateTextField("Логин", username, { username = it }); SecretTextField("Пароль", password, { password = it }, allowGenerate = true); PrivateTextField("URL", url, { url = it }); FolderPicker(folders, "password", folderId) { folderId = it }
    }
}

@Composable
private fun NoteEditor(
    item: NoteItem?,
    folders: List<VaultFolder>,
    initialFolder: String,
    repository: VaultRepository,
    onUserActivity: () -> Unit,
    startAudio: ((Result<Unit>) -> Unit) -> Unit,
    stopAudio: ((Result<AudioAttachment>) -> Unit) -> Unit,
    cancelAudio: () -> Unit,
    dismiss: () -> Unit,
    save: (NoteItem) -> Unit,
    delete: (String) -> Unit,
) {
    var title by remember(item?.id) { mutableStateOf(item?.title.orEmpty()) }
    var body by remember(item?.id) { mutableStateOf(item?.body.orEmpty()) }
    var folderId by remember(item?.id) { mutableStateOf(item?.folderId ?: initialFolder) }
    var audioFileId by remember(item?.id) { mutableStateOf(item?.audioFileId.orEmpty()) }
    var audioDuration by remember(item?.id) { mutableLongStateOf(item?.audioDurationMs ?: 0L) }
    var recording by remember { mutableStateOf(false) }
    var recordingSeconds by remember { mutableIntStateOf(0) }
    var audioError by remember { mutableStateOf("") }
    var committed by remember { mutableStateOf(false) }

    LaunchedEffect(recording) {
        recordingSeconds = 0
        while (recording) { delay(1_000); recordingSeconds++ }
    }

    fun close() {
        if (recording) cancelAudio()
        if (!committed && audioFileId.isNotBlank() && audioFileId != item?.audioFileId) repository.purgeAttachment(audioFileId)
        dismiss()
    }

    FormDialog(
        title = if (item == null) "Новая заметка" else "Изменить заметку",
        dismiss = ::close,
        valid = title.isNotBlank() && !recording,
        submit = {
            committed = true
            save(NoteItem(id = item?.id ?: java.util.UUID.randomUUID().toString(), title = title.trim(), body = body, folderId = folderId, audioFileId = audioFileId, audioDurationMs = audioDuration))
        },
        onUserActivity = onUserActivity,
        dangerLabel = if (item == null) null else "Переместить в корзину",
        onDanger = item?.let { { if (recording) cancelAudio(); committed = true; delete(it.id) } },
    ) {
        PrivateTextField("Название", title, { title = it })
        PrivateTextField("Текст", body, { body = it }, singleLine = false)
        when {
            recording -> GlassCard(Modifier.fillMaxWidth(), strong = true) {
                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.Mic, null, tint = NocturneDanger)
                    Text("Запись ${recordingSeconds / 60}:${(recordingSeconds % 60).toString().padStart(2, '0')}", Modifier.padding(start = 10.dp).weight(1f), color = NocturneInk)
                    Button(onClick = {
                        stopAudio { result -> result.onSuccess { attachment -> audioFileId = attachment.fileId; audioDuration = attachment.durationMs; recording = false; audioError = "" }.onFailure { recording = false; audioError = "Не удалось сохранить запись" } }
                    }) { Icon(Icons.Rounded.Stop, null); Spacer(Modifier.width(6.dp)); Text("Стоп") }
                }
            }
            audioFileId.isNotBlank() -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                AudioAttachmentPlayer(repository, audioFileId, "Аудиозаметка")
                TextButton(onClick = {
                    if (audioFileId != item?.audioFileId) repository.purgeAttachment(audioFileId)
                    audioFileId = ""
                    audioDuration = 0
                }) { Text("Удалить запись", color = NocturneDanger) }
            }
            else -> OutlinedButton(onClick = {
                startAudio { result -> result.onSuccess { recording = true; audioError = "" }.onFailure { audioError = if (it is SecurityException) "Разрешите доступ к микрофону, чтобы записывать аудиозаметки" else "Не удалось начать запись" } }
            }, Modifier.fillMaxWidth()) { Icon(Icons.Rounded.Mic, null); Spacer(Modifier.width(8.dp)); Text("Записать аудиозаметку") }
        }
        InlineError(audioError)
        FolderPicker(folders, "note", folderId) { folderId = it }
    }
}

@Composable
private fun OtpEditor(item: OtpItem?, dismiss: () -> Unit, save: (OtpItem) -> Unit, delete: (String) -> Unit, pickImage: ((Result<OtpItem>) -> Unit) -> Unit, scanCamera: ((Result<OtpItem>) -> Unit) -> Unit) {
    var issuer by remember(item?.id) { mutableStateOf(item?.issuer.orEmpty()) }; var account by remember(item?.id) { mutableStateOf(item?.account.orEmpty()) }; var secret by remember(item?.id) { mutableStateOf(item?.secret.orEmpty()) }; var error by remember { mutableStateOf("") }
    val valid = runCatching { Totp.decodeBase32(secret); secret.isNotBlank() }.getOrDefault(false)
    fun accept(result: Result<OtpItem>) { result.onSuccess { issuer = it.issuer; account = it.account; secret = it.secret; error = "" }.onFailure { if (it.message != "CANCELLED") error = "Не удалось распознать TOTP QR-код" } }
    FormDialog(if (item == null) "Новый TOTP" else "Изменить TOTP", dismiss, (issuer.isNotBlank() || account.isNotBlank()) && valid, { save(OtpItem(id = item?.id ?: java.util.UUID.randomUUID().toString(), issuer = issuer.trim(), account = account.trim(), secret = secret.filterNot(Char::isWhitespace).uppercase())) }, dangerLabel = if (item == null) null else "Переместить в корзину", onDanger = item?.let { { delete(it.id) } }) {
        Text("Добавить по QR", color = NocturneMuted, fontSize = 12.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { scanCamera(::accept) }, modifier = Modifier.weight(1f)) { Icon(Icons.Rounded.PhotoCamera, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Камера") }
            OutlinedButton(onClick = { pickImage(::accept) }, modifier = Modifier.weight(1f)) { Icon(Icons.Rounded.QrCode2, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Фото") }
        }
        PrivateTextField("Сервис", issuer, { issuer = it }); PrivateTextField("Аккаунт", account, { account = it }); SecretTextField("Секрет Base32", secret, { secret = it; error = if (it.isNotBlank() && !runCatching { Totp.decodeBase32(it); true }.getOrDefault(false)) "Неверный Base32-секрет" else "" }); InlineError(error)
    }
}

@Composable
private fun FormDialog(title: String, dismiss: () -> Unit, valid: Boolean, submit: () -> Unit, onUserActivity: () -> Unit = {}, dangerLabel: String? = null, onDanger: (() -> Unit)? = null, fields: @Composable ColumnScope.() -> Unit) {
    AdaptiveDialog(title, dismiss, onUserActivity, "Сохранить", valid, onPrimary = submit, dangerLabel = dangerLabel, onDanger = onDanger, content = fields)
}

@Composable
private fun QuickSetupDialog(repository: VaultRepository, systemAvailable: Boolean, configureSystem: (String, (Result<Unit>) -> Unit) -> Unit, hidePatternTrace: Boolean, onUserActivity: () -> Unit, dismiss: () -> Unit) {
    var mode by remember { mutableStateOf(QuickMode.PIN) }; var master by remember { mutableStateOf("") }; var verifiedMaster by remember { mutableStateOf<String?>(null) }; var pin by remember { mutableStateOf("") }; var confirm by remember { mutableStateOf("") }; var firstPattern by remember { mutableStateOf<String?>(null) }; var error by remember { mutableStateOf("") }; var loading by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    fun saveQuick(credential: String) { val confirmed = verifiedMaster ?: return; loading = true; scope.launch { val result = withContext(Dispatchers.Default) { runCatching { repository.configureQuick(mode, credential.toCharArray(), confirmed.toCharArray()) } }; loading = false; result.onSuccess { dismiss() }.onFailure { error = "Не удалось сохранить быстрый вход" } } }
    if (verifiedMaster == null) {
        AdaptiveDialog(
            title = "Подтвердите изменение",
            onDismiss = dismiss,
            onUserActivity = onUserActivity,
            primaryLabel = "Продолжить",
            primaryEnabled = master.isNotBlank() && !loading,
            primaryLoading = loading,
            onPrimary = { loading = true; scope.launch { val valid = withContext(Dispatchers.Default) { repository.verifyMasterPassword(master.toCharArray()) }; loading = false; if (valid) verifiedMaster = master else error = "Неверный мастер-пароль" } },
        ) {
                Text("Сначала введите текущий мастер-пароль. После проверки откроется выбор способа быстрой разблокировки.", color = NocturneMuted)
                SecretTextField("Текущий мастер-пароль", master, { master = it; error = "" })
                InlineError(error)
        }
        return
    }
    val primaryLabel = when (mode) { QuickMode.PIN -> "Сохранить"; QuickMode.SYSTEM -> "Подключить биометрию"; else -> null }
    val primaryEnabled = when (mode) { QuickMode.PIN -> !loading && pin.length in 6..12 && pin == confirm; QuickMode.SYSTEM -> !loading; else -> false }
    AdaptiveDialog("Быстрый вход", dismiss, onUserActivity, primaryLabel, primaryEnabled, loading, onPrimary = when (mode) {
        QuickMode.PIN -> {{ saveQuick(pin) }}
        QuickMode.SYSTEM -> {{ loading = true; configureSystem(verifiedMaster!!) { result -> loading = false; result.onSuccess { dismiss() }.onFailure { error = "Не удалось включить биометрию. Проверьте, что настроен надёжный отпечаток пальца или распознавание лица." } } }}
        else -> null
    }, dangerLabel = "Отключить быстрый вход", onDanger = { mode = QuickMode.NONE; saveQuick("") }) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { FilterChip(mode == QuickMode.PIN, { mode = QuickMode.PIN; error = "" }, { Text("PIN") }); FilterChip(mode == QuickMode.PATTERN, { mode = QuickMode.PATTERN; error = "" }, { Text("Рисунок") }); if (systemAvailable) FilterChip(mode == QuickMode.SYSTEM, { mode = QuickMode.SYSTEM; error = "" }, { Text("Android") }, leadingIcon = { Icon(Icons.Rounded.Android, null, Modifier.size(16.dp)) }) }
        Text("Выберите способ, который будет запрашиваться при каждом запуске и после блокировки.", color = NocturneMuted, fontSize = 12.sp)
        when (mode) {
            QuickMode.PIN -> { SecretTextField("Новый PIN", pin, { pin = it.filter(Char::isDigit).take(12) }, numeric = true); SecretTextField("Повторите PIN", confirm, { confirm = it.filter(Char::isDigit).take(12) }, numeric = true); if (confirm.isNotEmpty() && pin != confirm) InlineError("PIN-коды не совпадают") }
            QuickMode.PATTERN -> { Text(if (firstPattern == null) "Нарисуйте новый ключ" else "Повторите рисунок", color = NocturneMuted); PatternPad(Modifier.height(220.dp), showTrace = !hidePatternTrace) { value -> if (value.split('-').size < 5) error = "Нужно не менее 5 точек" else if (firstPattern == null) { firstPattern = value; error = "" } else if (firstPattern != value) { firstPattern = null; error = "Рисунки не совпадают. Начните заново." } else saveQuick(value) } }
            QuickMode.SYSTEM -> Text("Откроется защищённое окно Android. Подойдёт только надёжный отпечаток пальца или распознавание лица; пароль телефона не откроет хранилище.", color = NocturneMuted)
            else -> Unit
        }
        InlineError(error)
    }
}

@Composable
private fun TrashDialog(repository: VaultRepository, data: VaultData, dismiss: () -> Unit, changed: () -> Unit, onUserActivity: () -> Unit) {
    data class RowItem(val kind: String, val id: String, val title: String, val type: String)
    var confirmEmpty by remember { mutableStateOf(false) }
    var pendingPurge by remember { mutableStateOf<Triple<String, String, String>?>(null) }
    val nonFiles = data.deletedPasswords.map { RowItem("password", it.id, it.title, "Пароль") } +
        data.deletedNotes.map { RowItem("note", it.id, it.title, "Заметка") } +
        data.deletedOtp.map { RowItem("otp", it.id, it.issuer.ifBlank { it.account }, "TOTP") }
    val empty = nonFiles.isEmpty() && data.deletedFiles.isEmpty()
    AdaptiveDialog("Корзина", dismiss, onUserActivity, dangerLabel = if (empty) null else "Удалить всё навсегда", onDanger = if (empty) null else {{ confirmEmpty = true }}) {
            if (empty) Column(Modifier.fillMaxWidth().padding(vertical = 28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Rounded.RestoreFromTrash, null, Modifier.size(40.dp), tint = NocturneAccent)
                Text("Корзина пуста", color = NocturneInk, fontWeight = FontWeight.SemiBold)
            } else Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                data.deletedFiles.forEach { file ->
                    TrashRow(
                        title = file.name,
                        subtitle = friendlyMime(file),
                        preview = {
                            Box(Modifier.size(54.dp).clip(RoundedCornerShape(14.dp)).background(androidx.compose.ui.graphics.Color(0xFF171820)), contentAlignment = Alignment.Center) {
                                if (file.kind() in setOf(VaultFileKind.IMAGE, VaultFileKind.VIDEO)) MediaThumbnail(repository, file, Modifier.fillMaxSize(), crop = true) else FileTypeBadge(file)
                                if (file.kind() == VaultFileKind.VIDEO) Icon(Icons.Rounded.PlayCircle, "Видео", Modifier.size(24.dp), tint = NocturneInk)
                            }
                        },
                        restore = { repository.restoreTrash("file", file.id); changed() },
                        purge = { pendingPurge = Triple("file", file.id, file.name) },
                    )
                }
                nonFiles.forEach { row ->
                    TrashRow(row.title, row.type, preview = { Box(Modifier.size(54.dp).clip(RoundedCornerShape(14.dp)).background(NocturneAccentDeep.copy(alpha = 0.32f)), contentAlignment = Alignment.Center) { Icon(if (row.kind == "password") Icons.Rounded.Key else if (row.kind == "note") Icons.Rounded.NoteAlt else Icons.Rounded.VpnKey, null, tint = NocturneAccent) } }, restore = { repository.restoreTrash(row.kind, row.id); changed() }, purge = { pendingPurge = Triple(row.kind, row.id, row.title) })
                }
            }
    }
    if (confirmEmpty) AdaptiveDialog("Очистить корзину?", { confirmEmpty = false }, onUserActivity, dangerLabel = "Удалить навсегда", onDanger = { repository.emptyTrash(); changed(); confirmEmpty = false }) {
        Text("Будут безвозвратно удалены все ${data.trashCount} объектов. Это действие нельзя отменить.", color = NocturneMuted)
    }
    pendingPurge?.let { pending ->
        AdaptiveDialog("Удалить навсегда?", { pendingPurge = null }, onUserActivity, dangerLabel = "Удалить навсегда", onDanger = { repository.purgeTrash(pending.first, pending.second); changed(); pendingPurge = null }) {
            Text("«${pending.third}» нельзя будет восстановить после удаления.", color = NocturneMuted)
        }
    }
}

@Composable
private fun TrashRow(title: String, subtitle: String, preview: @Composable () -> Unit, restore: () -> Unit, purge: () -> Unit) {
    GlassCard(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            preview()
            Column(Modifier.weight(1f)) {
                Text(title, color = NocturneInk, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(subtitle, color = NocturneMuted, fontSize = 11.sp)
            }
            IconButton(onClick = restore) { Icon(Icons.Rounded.RestoreFromTrash, "Восстановить", tint = NocturneAccent) }
            IconButton(onClick = purge) { Icon(Icons.Rounded.Delete, "Удалить навсегда", tint = NocturneDanger) }
        }
    }
}

@Composable
private fun ChangeMasterDialog(repository: VaultRepository, onUserActivity: () -> Unit, dismiss: () -> Unit) {
    var old by remember { mutableStateOf("") }; var fresh by remember { mutableStateOf("") }; var confirm by remember { mutableStateOf("") }; var error by remember { mutableStateOf("") }; var loading by remember { mutableStateOf(false) }; val scope = rememberCoroutineScope()
    AdaptiveDialog("Сменить мастер-пароль", dismiss, onUserActivity, "Изменить", !loading && old.isNotBlank() && SecurityPolicy.isStrongMaster(fresh) && fresh == confirm, loading, onPrimary = { loading = true; scope.launch { val result = withContext(Dispatchers.Default) { runCatching { repository.changeMasterPassword(old.toCharArray(), fresh.toCharArray()) } }; loading = false; result.onSuccess { dismiss() }.onFailure { error = "Текущий мастер-пароль неверен" } } }) { SecretTextField("Текущий мастер-пароль", old, { old = it; error = "" }); SecretTextField("Новый мастер-пароль", fresh, { fresh = it; error = "" }, allowGenerate = true); SecretTextField("Повторите новый пароль", confirm, { confirm = it }); PasswordChecklist(fresh); if (confirm.isNotEmpty() && confirm != fresh) InlineError("Пароли не совпадают"); InlineError(error) }
}

private fun quickModeName(mode: QuickMode) = when (mode) { QuickMode.NONE -> "Не настроен"; QuickMode.PIN -> "PIN-код"; QuickMode.PATTERN -> "Рисунок Nocturne"; QuickMode.SYSTEM -> "Биометрия Android" }
private fun autoLockLabel(seconds: Int) = when (seconds) { 30 -> "30 сек"; 60 -> "1 мин"; 120 -> "2 мин"; 300 -> "5 мин"; 600 -> "10 мин"; 1800 -> "30 мин"; else -> "$seconds сек" }
private fun clipboardLabel(seconds: Int) = if (seconds == 0) "Не очищать по таймеру" else if (seconds < 60) "$seconds сек" else "${seconds / 60} мин"
private fun friendlyMime(item: StoredFile) = when (item.kind()) { VaultFileKind.IMAGE -> "Изображение"; VaultFileKind.VIDEO -> "Видео"; VaultFileKind.AUDIO -> "Аудио"; VaultFileKind.PDF -> "PDF"; VaultFileKind.DOCUMENT -> "Документ"; VaultFileKind.OTHER -> "Файл" }
private fun formatBytes(bytes: Long) = when { bytes < 1024 -> "$bytes Б"; bytes < 1024 * 1024 -> "${bytes / 1024} КБ"; else -> "${"%.1f".format(bytes / 1024.0 / 1024.0)} МБ" }
private fun importStageLabel(item: ImportItemState) = when (item.stage) { ImportStage.QUEUED -> "В очереди"; ImportStage.READING -> "Чтение ${(item.progress * 100).toInt()}%"; ImportStage.ENCRYPTING -> "Шифрование"; ImportStage.DONE -> "Готово"; ImportStage.FAILED -> item.message.ifBlank { "Ошибка" } }
