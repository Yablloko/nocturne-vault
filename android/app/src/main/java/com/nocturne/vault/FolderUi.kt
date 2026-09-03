package com.nocturne.vault

import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.DriveFileRenameOutline
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun FolderPath(
    folders: List<VaultFolder>,
    currentId: String,
    onNavigate: (String) -> Unit,
) {
    if (currentId.isBlank()) return
    val current = folders.firstOrNull { it.id == currentId } ?: return
    Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = { onNavigate(current.parentId) }) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Назад") }
        Column {
            Text(current.name, color = NocturneInk, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("Папка", color = NocturneMuted, fontSize = 11.sp)
        }
    }
}

@Composable
fun FolderCard(
    folder: VaultFolder,
    selected: Boolean = false,
    selectionCount: Int = if (selected) 1 else 0,
    onOpen: () -> Unit,
    onLongPress: () -> Unit = {},
    onRename: () -> Unit = {},
    onDeleteSelection: () -> Unit = {},
    onDeselect: () -> Unit = {},
) {
    GlassCard(Modifier.fillMaxWidth().combinedClickable(onClick = onOpen, onLongClick = onLongPress), strong = selected) {
        Column(Modifier.fillMaxWidth()) {
            Row(Modifier.fillMaxWidth().padding(15.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(if (selected) Icons.Rounded.CheckCircle else Icons.Rounded.Folder, null, Modifier.size(28.dp), tint = NocturneAccent)
                Text(folder.name, Modifier.weight(1f), color = NocturneInk, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (selected && selectionCount > 1) Text("Выбрано: $selectionCount", color = NocturneMuted, fontSize = 11.sp)
            }
            if (selected) {
                Row(
                    Modifier.fillMaxWidth().padding(start = 46.dp, end = 8.dp, bottom = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.End,
                ) {
                    if (selectionCount == 1) IconButton(onClick = onRename) { Icon(Icons.Rounded.DriveFileRenameOutline, "Переименовать") }
                    IconButton(onClick = onDeleteSelection) { Icon(Icons.Rounded.Delete, if (selectionCount == 1) "Удалить папку" else "Удалить выбранные папки", tint = NocturneDanger) }
                    IconButton(onClick = onDeselect) { Icon(Icons.Rounded.Close, "Снять выделение") }
                }
            }
        }
    }
}

@Composable
fun CreateFolderDialog(
    kind: String,
    parentId: String,
    onDismiss: () -> Unit,
    onUserActivity: () -> Unit,
    onSave: (VaultFolder) -> Unit,
) {
    var name by remember { mutableStateOf("") }
    AdaptiveDialog(
        title = "Новая папка",
        onDismiss = onDismiss,
        onUserActivity = onUserActivity,
        primaryLabel = "Создать",
        primaryEnabled = name.trim().isNotEmpty(),
        onPrimary = { onSave(VaultFolder(name = name.trim(), kind = kind, parentId = parentId)) },
    ) {
        Text("Папка будет создана внутри текущего раздела.", color = NocturneMuted, fontSize = 12.sp)
        PrivateTextField("Название", name, { name = it.take(80) })
    }
}

@Composable
fun RenameFolderDialog(folder: VaultFolder, onDismiss: () -> Unit, onUserActivity: () -> Unit, onSave: (VaultFolder) -> Unit) {
    var name by remember(folder.id) { mutableStateOf(folder.name) }
    AdaptiveDialog(
        title = "Переименовать папку",
        onDismiss = onDismiss,
        onUserActivity = onUserActivity,
        primaryLabel = "Сохранить",
        primaryEnabled = name.trim().isNotEmpty() && name.trim() != folder.name,
        onPrimary = { onSave(folder.copy(name = name.trim())) },
    ) {
        PrivateTextField("Название", name, { name = it.take(80) })
    }
}

@Composable
fun DeleteFolderDialog(folders: List<VaultFolder>, onDismiss: () -> Unit, onUserActivity: () -> Unit, onDelete: () -> Unit) {
    val single = folders.singleOrNull()
    AdaptiveDialog(
        title = if (single != null) "Удалить папку?" else "Удалить папки?",
        onDismiss = onDismiss,
        onUserActivity = onUserActivity,
        dangerLabel = if (single != null) "Удалить папку" else "Удалить ${folders.size} папки",
        onDanger = onDelete,
    ) {
        Text(
            if (single != null) "Папка «${single.name}», все вложенные папки и их содержимое будут перемещены в корзину."
            else "Выбранные папки, все вложенные папки и их содержимое будут перемещены в корзину.",
            color = NocturneMuted,
            fontSize = 13.sp,
        )
    }
}

@Composable
fun FolderPicker(
    folders: List<VaultFolder>,
    kind: String,
    selectedId: String,
    onSelect: (String) -> Unit,
) {
    val available = folders.filter { it.kind == kind }
    if (available.isEmpty()) return
    Text("Папка", color = NocturneMuted, fontSize = 12.sp)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
        FilterChip(selected = selectedId.isBlank(), onClick = { onSelect("") }, label = { Text("Без папки") })
        available.take(3).forEach { folder ->
            FilterChip(selected = selectedId == folder.id, onClick = { onSelect(folder.id) }, label = { Text(folder.name, maxLines = 1) })
        }
    }
    if (available.size > 3) {
        available.drop(3).chunked(3).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                row.forEach { folder -> FilterChip(selectedId == folder.id, { onSelect(folder.id) }, { Text(folder.name, maxLines = 1) }) }
            }
        }
    }
}
