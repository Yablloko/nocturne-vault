package com.nocturne.vault

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.IntSize
import kotlin.math.abs
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun PatternPad(
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    showTrace: Boolean = true,
    onComplete: (String) -> Unit,
) {
    val selected = remember { mutableStateListOf<Int>() }
    var canvasSize by remember { mutableStateOf(IntSize.Zero) }
    var pointer by remember { mutableStateOf<Offset?>(null) }
    val nodeProgress = remember { List(9) { Animatable(0f) } }
    val lineAlpha by animateFloatAsState(
        targetValue = if (pointer == null) 0f else 1f,
        animationSpec = spring(dampingRatio = 1f, stiffness = 650f),
        label = "pattern-line",
    )

    LaunchedEffect(selected.toList()) {
        nodeProgress.forEachIndexed { index, value ->
            launch { value.animateTo(if (index in selected) 1f else 0f, spring(dampingRatio = 0.82f, stiffness = 700f)) }
        }
    }
    LaunchedEffect(pointer) {
        if (pointer == null && selected.isNotEmpty()) {
            delay(160)
            selected.clear()
        }
    }

    fun center(index: Int): Offset {
        val col = index % 3
        val row = index / 3
        return Offset(canvasSize.width * (col + 0.5f) / 3f, canvasSize.height * (row + 0.5f) / 3f)
    }

    fun nearest(point: Offset): Int? = (0..8)
        .minByOrNull { (center(it) - point).getDistance() }
        ?.takeIf { (center(it) - point).getDistance() < canvasSize.width / 7.5f }

    fun addNode(node: Int) {
        if (node in selected) return
        val previous = selected.lastOrNull()
        if (previous != null) {
            val previousRow = previous / 3
            val previousCol = previous % 3
            val row = node / 3
            val col = node % 3
            if (abs(previousRow - row) % 2 == 0 && abs(previousCol - col) % 2 == 0) {
                val middle = ((previousRow + row) / 2) * 3 + (previousCol + col) / 2
                if (middle != previous && middle != node && middle !in selected) selected += middle
            }
        }
        selected += node
    }

    Canvas(
        modifier.fillMaxWidth().aspectRatio(1f)
            .onSizeChanged { canvasSize = it }
            .pointerInput(enabled) {
                if (!enabled) return@pointerInput
                detectDragGestures(
                    onDragStart = { point -> selected.clear(); pointer = point; nearest(point)?.let(::addNode) },
                    onDrag = { change, _ ->
                        change.consume()
                        pointer = change.position
                        nearest(change.position)?.let(::addNode)
                    },
                    onDragEnd = {
                        val result = selected.joinToString("-")
                        pointer = null
                        if (result.isNotEmpty()) onComplete(result)
                    },
                    onDragCancel = { pointer = null; selected.clear() },
                )
            },
    ) {
        if (showTrace) {
            selected.zipWithNext().forEach { (a, b) ->
                drawLine(NocturneAccent.copy(alpha = lineAlpha), center(a), center(b), strokeWidth = 8f, cap = StrokeCap.Round)
            }
            if (selected.isNotEmpty() && pointer != null) {
                drawLine(NocturneAccent.copy(alpha = 0.55f), center(selected.last()), pointer!!, strokeWidth = 7f, cap = StrokeCap.Round)
            }
        }
        repeat(9) { index ->
            val progress = if (showTrace) nodeProgress[index].value else 0f
            val active = progress > 0.01f
            drawCircle(
                color = if (active) NocturneAccent.copy(alpha = 0.18f * progress) else NocturnePanel,
                radius = 29f + 6f * progress,
                center = center(index),
            )
            drawCircle(
                color = if (active) NocturneAccent else NocturneLine.copy(alpha = 0.9f),
                radius = 26f + 3f * progress,
                center = center(index),
                style = Stroke(width = 3f + 3f * progress),
            )
            drawCircle(if (active) NocturneAccent else NocturneMuted, radius = 6f + 2f * progress, center = center(index))
        }
    }
}
