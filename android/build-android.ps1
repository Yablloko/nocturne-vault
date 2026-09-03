$ErrorActionPreference = 'Stop'
$sdk = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } elseif ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path -LiteralPath $sdk)) {
  throw "Android SDK не найден. Установите Android Studio и SDK Platform 37, затем задайте ANDROID_SDK_ROOT."
}
$env:ANDROID_SDK_ROOT = $sdk
$buildRoot = $PSScriptRoot
$wrapperPath = Join-Path $PSScriptRoot 'gradle\wrapper\gradle-wrapper.jar'
$expectedWrapperSha256 = '55243ef57851f12b070ad14f7f5bb8302daceeebc5bce5ece5fa6edb23e1145c'
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $wrapperPath).Hash.ToLowerInvariant() -ne $expectedWrapperSha256) {
  throw 'Gradle Wrapper JAR не совпадает с официальной контрольной суммой.'
}
$temporaryDrive = $null
if ($PSScriptRoot -match '[^\x00-\x7F]') {
  $usedDrives = [System.IO.DriveInfo]::GetDrives().Name
  $temporaryDrive = @('Z:', 'Y:', 'X:', 'W:', 'V:') | Where-Object { "$($_)\" -notin $usedDrives } | Select-Object -First 1
  if (-not $temporaryDrive) { throw 'Не найден свободный диск для безопасной сборки из пути с кириллицей.' }
  & subst.exe $temporaryDrive $PSScriptRoot
  if ($LASTEXITCODE -ne 0) { throw "Не удалось создать временный диск $temporaryDrive." }
  $buildRoot = "$temporaryDrive\"
}

Push-Location -LiteralPath $buildRoot
try {
  & "$buildRoot\gradlew.bat" :app:clean :app:testDebugUnitTest :app:assembleDebug --no-daemon --max-workers=1
  $gradleExitCode = $LASTEXITCODE
} finally {
  Pop-Location
  if ($temporaryDrive) { & subst.exe $temporaryDrive /D | Out-Null }
}
if ($gradleExitCode -ne 0) { exit $gradleExitCode }
Write-Host "APK: $PSScriptRoot\app\build\outputs\apk\debug\app-debug.apk"
