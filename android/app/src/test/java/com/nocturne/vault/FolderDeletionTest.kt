package com.nocturne.vault

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FolderDeletionTest {
    @Test fun deletingParentMovesItsWholeTreeAndContentsToTrash() {
        val parent = VaultFolder(id = "parent", name = "Parent", kind = "password")
        val child = VaultFolder(id = "child", name = "Child", kind = "password", parentId = parent.id)
        val grandchild = VaultFolder(id = "grandchild", name = "Grandchild", kind = "password", parentId = child.id)
        val unrelated = VaultFolder(id = "unrelated", name = "Unrelated", kind = "password")
        val value = VaultData(
            folders = mutableListOf(parent, child, grandchild, unrelated),
            passwords = mutableListOf(
                PasswordItem(id = "p1", title = "Parent secret", password = "one", folderId = parent.id),
                PasswordItem(id = "p2", title = "Nested secret", password = "two", folderId = grandchild.id),
                PasswordItem(id = "p3", title = "Keep", password = "three", folderId = unrelated.id),
            ),
            notes = mutableListOf(NoteItem(id = "n1", title = "Nested note", folderId = child.id)),
            files = mutableListOf(
                StoredFile(id = "f1", name = "inside.pdf", mime = "application/pdf", size = 10, folderId = child.id),
                StoredFile(id = "audio", name = "note.m4a", mime = "audio/mp4", size = 4, folderId = child.id, purpose = StoredFile.PURPOSE_NOTE_AUDIO),
            ),
        )

        moveFolderTreesToTrash(value, setOf(parent.id))

        assertEquals(listOf(unrelated), value.folders)
        assertEquals(listOf("Keep"), value.passwords.map { it.title })
        assertTrue(value.notes.isEmpty())
        assertEquals(listOf("note.m4a"), value.files.map { it.name })
        assertEquals(setOf("Parent secret", "Nested secret"), value.deletedPasswords.map { it.title }.toSet())
        assertEquals(listOf("Nested note"), value.deletedNotes.map { it.title })
        assertEquals(listOf("inside.pdf"), value.deletedFiles.map { it.name })
        assertTrue((value.deletedPasswords.map { it.folderId } + value.deletedNotes.map { it.folderId } + value.deletedFiles.map { it.folderId }).all(String::isBlank))
    }

    @Test fun overlappingOrRepeatedDeletionDoesNotDuplicateTrashRecords() {
        val parent = VaultFolder(id = "parent", name = "Parent", kind = "password")
        val child = VaultFolder(id = "child", name = "Child", kind = "password", parentId = parent.id)
        val value = VaultData(
            folders = mutableListOf(parent, child),
            passwords = mutableListOf(PasswordItem(id = "p1", title = "Secret", password = "one", folderId = child.id)),
        )

        moveFolderTreesToTrash(value, setOf(parent.id, child.id))
        moveFolderTreesToTrash(value, setOf(parent.id, child.id))

        assertTrue(value.folders.isEmpty())
        assertTrue(value.passwords.isEmpty())
        assertEquals(listOf("p1"), value.deletedPasswords.map { it.id })
    }
}
