package com.nocturne.vault

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.AudioFile
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.Key
import androidx.compose.material.icons.rounded.Password
import androidx.compose.material.icons.rounded.PhotoLibrary
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

private data class OnboardingPage(
    val icon: ImageVector?,
    val eyebrow: String,
    val title: String,
    val body: String,
)

private val onboardingPages = listOf(
    OnboardingPage(null, "ДОБРО ПОЖАЛОВАТЬ", "Ваше личное хранилище", "Nocturne хранит данные локально в зашифрованном контейнере. Мастер-пароль остаётся ключом восстановления."),
    OnboardingPage(Icons.Rounded.Password, "ПАРОЛИ", "Аккаунты без хаоса", "Сохраняйте логины, пароли и сайты по папкам. Генератор создаст стойкий пароль, а системное автозаполнение можно подключить отдельно."),
    OnboardingPage(Icons.Rounded.PhotoLibrary, "ФАЙЛЫ", "Единая защищённая галерея", "Импортируйте несколько фото, видео, аудио и документов. Оригиналы остаются на месте, а копии шифруются внутри Nocturne."),
    OnboardingPage(Icons.Rounded.Folder, "ПОРЯДОК", "Папки и быстрый поиск", "Пароли, заметки и файлы можно разложить по папкам. В файлах доступны поиск, фильтры и групповое выделение."),
    OnboardingPage(Icons.Rounded.AudioFile, "ЗАМЕТКИ И КОДЫ", "Текст, голос и TOTP", "Создавайте текстовые и аудиозаметки. Одноразовые коды добавляются камерой, фотографией QR или секретом Base32."),
    OnboardingPage(Icons.Rounded.Key, "БЫСТРЫЙ ВХОД", "Удобно, но под контролем", "Выберите PIN, рисунок или биометрию Android. После настройки этот способ запрашивается при запуске и после блокировки."),
    OnboardingPage(Icons.Rounded.AutoAwesome, "ГОТОВО", "Настройте Nocturne под себя", "В настройках можно управлять скриншотами, приватным режимом клавиатуры, очисткой буфера, быстрым входом и таймером блокировки."),
)

@Composable
fun OnboardingScreen(onComplete: () -> Unit, canClose: Boolean = false) {
    val pager = rememberPagerState(pageCount = { onboardingPages.size })
    val scope = rememberCoroutineScope()
    val last = pager.currentPage == onboardingPages.lastIndex
    Box(Modifier.fillMaxSize().background(NocturneNight).statusBarsPadding().navigationBarsPadding()) {
        Column(Modifier.fillMaxSize().padding(horizontal = 22.dp, vertical = 12.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = onComplete) { Text(if (canClose) "Закрыть" else "Пропустить", color = NocturneMuted) }
            }
            HorizontalPager(state = pager, modifier = Modifier.weight(1f)) { index -> OnboardingPageContent(onboardingPages[index]) }
            Row(Modifier.fillMaxWidth().padding(vertical = 18.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                onboardingPages.indices.forEach { index ->
                    val width by animateDpAsState(if (index == pager.currentPage) 26.dp else 7.dp, spring(dampingRatio = 0.82f, stiffness = 600f), label = "indicator")
                    Box(Modifier.padding(horizontal = 3.dp).height(7.dp).size(width, 7.dp).clip(CircleShape).background(if (index == pager.currentPage) NocturneAccent else NocturneMuted.copy(alpha = .35f)))
                }
            }
            Button(
                onClick = { if (last) onComplete() else scope.launch { pager.animateScrollToPage(pager.currentPage + 1) } },
                modifier = Modifier.fillMaxWidth().height(54.dp),
                shape = RoundedCornerShape(18.dp),
            ) { AnimatedContent(last, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "next") { done -> Text(if (done) "Начать" else "Далее", fontWeight = FontWeight.SemiBold) } }
        }
    }
}

@Composable
private fun OnboardingPageContent(page: OnboardingPage) {
    Column(
        Modifier.fillMaxSize().padding(horizontal = 10.dp).animateContentSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (page.icon == null) {
            Image(
                painter = painterResource(R.drawable.ic_nocturne),
                contentDescription = "Иконка Nocturne",
                modifier = Modifier.size(96.dp).clip(RoundedCornerShape(30.dp)),
            )
        } else {
            Box(Modifier.size(116.dp).clip(RoundedCornerShape(38.dp)).background(NocturneAccentDeep.copy(alpha = .32f)), contentAlignment = Alignment.Center) {
                Icon(page.icon, null, Modifier.size(54.dp), tint = NocturneAccent)
            }
        }
        Spacer(Modifier.height(32.dp))
        Text(page.eyebrow, color = NocturneAccent, fontSize = 11.sp, letterSpacing = 1.5.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(10.dp))
        Text(page.title, color = NocturneInk, fontSize = 32.sp, lineHeight = 36.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
        Spacer(Modifier.height(14.dp))
        Text(page.body, color = NocturneMuted, fontSize = 15.sp, lineHeight = 22.sp, textAlign = TextAlign.Center)
    }
}
