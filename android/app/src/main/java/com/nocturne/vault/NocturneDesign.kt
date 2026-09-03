package com.nocturne.vault

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.RadioButtonUnchecked
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Surface
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.PlatformImeOptions
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

val NocturneInk = Color(0xFFF6F4FA)
val NocturneMuted = Color(0xFFB5B1BD)
val NocturneNight = Color(0xFF090A0D)
val NocturnePanel = Color(0xB82A2930)
val NocturnePanelStrong = Color(0xF22A2930)
val NocturneLine = Color(0x3DFFFFFF)
val NocturneAccent = Color(0xFFC9BEFF)
val NocturneAccentDeep = Color(0xFF7D69D9)
val NocturneDanger = Color(0xFFFFB4AB)
val NocturneSuccess = Color(0xFFA8DAB5)

private val scheme = darkColorScheme(
    primary = NocturneAccent,
    onPrimary = Color(0xFF211B39),
    secondary = Color(0xFFBFC2FF),
    background = NocturneNight,
    surface = NocturnePanelStrong,
    surfaceVariant = Color(0xFF303038),
    surfaceContainer = Color(0xFF24232A),
    surfaceContainerHigh = Color(0xFF2E2D35),
    surfaceContainerHighest = Color(0xFF373640),
    onSecondaryContainer = NocturneInk,
    onPrimaryContainer = NocturneInk,
    onBackground = NocturneInk,
    onSurface = NocturneInk,
    onSurfaceVariant = NocturneMuted,
    error = NocturneDanger,
)

@Composable
fun NocturneTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme) {
        CompositionLocalProvider(LocalContentColor provides NocturneInk, content = content)
    }
}

@Composable
fun NocturneBackground(content: @Composable () -> Unit) {
    Box(
        Modifier.fillMaxSize().background(
            Brush.verticalGradient(listOf(Color(0xFF111018), NocturneNight, Color(0xFF0B0D12))),
        ),
    ) {
        Box(
            Modifier.size(280.dp).align(Alignment.TopEnd).blur(70.dp)
                .background(Color(0x297D69D9), CircleShape),
        )
        Box(
            Modifier.size(220.dp).align(Alignment.BottomStart).blur(80.dp)
                .background(Color(0x1E426B88), CircleShape),
        )
        content()
    }
}

@Composable
fun GlassCard(
    modifier: Modifier = Modifier,
    strong: Boolean = false,
    content: @Composable () -> Unit,
) {
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = if (strong) NocturnePanelStrong else NocturnePanel, contentColor = NocturneInk),
        border = BorderStroke(1.dp, NocturneLine),
        elevation = CardDefaults.cardElevation(defaultElevation = if (strong) 14.dp else 4.dp),
    ) { content() }
}

@Composable
fun NocturneButton(
    label: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
    onClick: () -> Unit,
) {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed) 0.975f else 1f,
        animationSpec = spring(dampingRatio = 1f, stiffness = 700f),
        label = "button-press",
    )
    Button(
        onClick = onClick,
        enabled = enabled && !loading,
        interactionSource = source,
        modifier = modifier.fillMaxWidth().height(56.dp).scale(scale),
        shape = RoundedCornerShape(18.dp),
        colors = ButtonDefaults.buttonColors(containerColor = NocturneAccent, contentColor = Color(0xFF201A37)),
    ) {
        if (loading) {
            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = Color(0xFF201A37))
            Spacer(Modifier.size(10.dp))
        }
        Text(label, fontWeight = FontWeight.SemiBold)
    }
}

val LocalAnonymousKeyboard = staticCompositionLocalOf { true }

@Composable
private fun secureKeyboardOptions(type: KeyboardType, forcePrivate: Boolean): KeyboardOptions {
    val private = forcePrivate || LocalAnonymousKeyboard.current
    return KeyboardOptions(
        capitalization = KeyboardCapitalization.None,
        autoCorrectEnabled = if (private) false else null,
        keyboardType = if (private && type == KeyboardType.Text) KeyboardType.Password else type,
        platformImeOptions = if (private) PlatformImeOptions(
            "com.google.android.inputmethod.latin.noPersonalizedLearning=true;" +
                "com.google.android.inputmethod.latin.noMicrophoneKey=true;" +
                "noPersonalizedLearning=true;noMicrophoneKey=true",
        ) else null,
    )
}

@Composable
fun SecretTextField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    numeric: Boolean = false,
    allowGenerate: Boolean = false,
    supportingText: String? = null,
) {
    var visible by remember { mutableStateOf(false) }
    OutlinedTextField(
        value = value,
        onValueChange = { next ->
            if (next.isEmpty()) visible = false
            onValueChange(next)
        },
        modifier = modifier.fillMaxWidth(),
        label = { Text(label) },
        singleLine = true,
        shape = RoundedCornerShape(18.dp),
        visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
        keyboardOptions = secureKeyboardOptions(if (numeric) KeyboardType.NumberPassword else KeyboardType.Password, forcePrivate = true),
        supportingText = supportingText?.let { { Text(it) } },
        trailingIcon = {
            Row {
                if (allowGenerate) {
                    IconButton(onClick = { onValueChange(SecurityPolicy.generate()) }) {
                        Icon(Icons.Rounded.AutoAwesome, "Сгенерировать пароль")
                    }
                }
                if (value.isNotEmpty()) {
                    IconButton(onClick = { visible = !visible }) {
                        Icon(if (visible) Icons.Rounded.VisibilityOff else Icons.Rounded.Visibility, if (visible) "Скрыть пароль" else "Показать пароль")
                    }
                }
            }
        },
    )
}

@Composable
fun PrivateTextField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    singleLine: Boolean = true,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.fillMaxWidth(),
        label = { Text(label) },
        singleLine = singleLine,
        minLines = if (singleLine) 1 else 4,
        shape = RoundedCornerShape(18.dp),
        keyboardOptions = secureKeyboardOptions(KeyboardType.Text, forcePrivate = false),
    )
}

@Composable
fun PasswordChecklist(value: String, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        SecurityPolicy.masterRequirements(value).forEach { requirement ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(
                    if (requirement.met) Icons.Rounded.CheckCircle else Icons.Rounded.RadioButtonUnchecked,
                    null,
                    tint = if (requirement.met) NocturneSuccess else NocturneMuted,
                    modifier = Modifier.size(17.dp),
                )
                Text(requirement.label, color = if (requirement.met) NocturneSuccess else NocturneMuted, fontSize = 12.sp)
            }
        }
    }
}

@Composable
fun InlineError(message: String) {
    AnimatedVisibility(message.isNotEmpty(), enter = fadeIn(tween(140)), exit = fadeOut(tween(90))) {
        Row(
            Modifier.fillMaxWidth().padding(top = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(Icons.Rounded.ErrorOutline, null, tint = NocturneDanger, modifier = Modifier.size(18.dp))
            Text(message, color = NocturneDanger, fontSize = 13.sp)
        }
    }
}

fun Modifier.trackUserActivity(onActivity: () -> Unit): Modifier = pointerInput(onActivity) {
    awaitPointerEventScope {
        while (true) {
            awaitPointerEvent(PointerEventPass.Initial)
            onActivity()
        }
    }
}

@Composable
fun AdaptiveDialog(
    title: String,
    onDismiss: () -> Unit,
    onUserActivity: () -> Unit = {},
    primaryLabel: String? = null,
    primaryEnabled: Boolean = true,
    primaryLoading: Boolean = false,
    onPrimary: (() -> Unit)? = null,
    dangerLabel: String? = null,
    onDanger: (() -> Unit)? = null,
    dangerEnabled: Boolean = true,
    secondaryLabel: String = "Отмена",
    content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit,
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        BoxWithConstraints(
            Modifier.fillMaxSize().navigationBarsPadding().imePadding().padding(horizontal = 18.dp, vertical = 20.dp),
            contentAlignment = Alignment.Center,
        ) {
            val contentHeightLimit = maxHeight * 0.64f
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .widthIn(max = 560.dp)
                    .heightIn(max = maxHeight * 0.9f)
                    .trackUserActivity(onUserActivity),
                shape = RoundedCornerShape(30.dp),
                color = NocturnePanelStrong,
                contentColor = NocturneInk,
                tonalElevation = 14.dp,
                shadowElevation = 18.dp,
                border = BorderStroke(1.dp, NocturneLine),
            ) {
                Column(Modifier.fillMaxWidth().padding(22.dp)) {
                    Text(title, color = NocturneInk, fontSize = 25.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.4).sp)
                    Spacer(Modifier.height(16.dp))
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(max = contentHeightLimit)
                            .verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                        content = content,
                    )
                    Spacer(Modifier.height(14.dp))
                    if (dangerLabel != null && onDanger != null) {
                        TextButton(onClick = onDanger, enabled = dangerEnabled, modifier = Modifier.fillMaxWidth()) { Text(dangerLabel, color = if (dangerEnabled) NocturneDanger else NocturneMuted) }
                    }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                        TextButton(onClick = onDismiss) { Text(secondaryLabel) }
                        if (primaryLabel != null && onPrimary != null) {
                            Spacer(Modifier.size(8.dp))
                            Button(onClick = onPrimary, enabled = primaryEnabled && !primaryLoading) {
                                if (primaryLoading) {
                                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                                    Spacer(Modifier.size(8.dp))
                                }
                                Text(primaryLabel)
                            }
                        }
                    }
                }
            }
        }
    }
}
