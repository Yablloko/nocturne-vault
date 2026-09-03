package com.nocturne.vault

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class BackupChoiceDialogTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun backupDialogShowsBothActionsAndDispatchesSelection() {
        var selected = ""
        compose.setContent {
            NocturneTheme {
                BackupChoiceDialog(
                    dismiss = {},
                    onUserActivity = {},
                    export = { selected = "export" },
                    import = { selected = "import" },
                )
            }
        }

        compose.onNodeWithText("Экспорт").assertExists().performClick()
        assertEquals("export", selected)
        compose.onNodeWithText("Импорт").assertExists().performClick()
        assertEquals("import", selected)
    }
}
