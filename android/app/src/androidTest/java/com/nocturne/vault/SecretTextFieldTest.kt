package com.nocturne.vault

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import org.junit.Rule
import org.junit.Test

class SecretTextFieldTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun visibilityControlOnlyAppearsForNonEmptyPassword() {
        var password by mutableStateOf("")
        compose.setContent {
            MaterialTheme {
                SecretTextField(
                    label = "Пароль",
                    value = password,
                    onValueChange = { password = it },
                )
            }
        }

        compose.onNodeWithContentDescription("Показать пароль").assertDoesNotExist()
        compose.onNode(hasSetTextAction()).performTextInput("secret")
        compose.onNodeWithContentDescription("Показать пароль").assertExists()
        compose.onNode(hasSetTextAction()).performTextClearance()
        compose.onNodeWithContentDescription("Показать пароль").assertDoesNotExist()
    }
}
