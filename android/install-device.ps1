param(
  [string]$Serial,
  [string]$ApkPath
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sdk = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } elseif ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$adb = Join-Path $sdk 'platform-tools\adb.exe'
if (-not $ApkPath) { $ApkPath = Join-Path $projectRoot 'dist\Nocturne-Vault-Android-0.9.11-release.apk' }
if (-not (Test-Path -LiteralPath $adb)) { throw "ADB не найден: $adb" }
if (-not (Test-Path -LiteralPath $ApkPath)) { throw "Release APK не найден: $ApkPath" }

& $adb start-server | Out-Null
$devices = @(& $adb devices | Select-Object -Skip 1 | ForEach-Object {
  if ($_ -match '^([^\s]+)\s+device$' -and $Matches[1] -notlike 'emulator-*') { $Matches[1] }
})
if ($Serial) {
  if ($Serial -notin $devices) { throw "Устройство $Serial не подключено или не подтвердило USB-отладку." }
  $target = $Serial
} elseif ($devices.Count -eq 1) {
  $target = $devices[0]
} elseif ($devices.Count -eq 0) {
  throw 'Телефон не найден. Включите режим разработчика и USB-отладку, подключите кабель и подтвердите RSA-ключ на телефоне.'
} else {
  throw "Подключено несколько телефонов: $($devices -join ', '). Запустите скрипт с -Serial."
}

& $adb -s $target install -r $ApkPath
if ($LASTEXITCODE -ne 0) {
  throw 'Установка не выполнена. Если уже установлена debug-сборка Nocturne с другой подписью, сначала экспортируйте нужные данные и удалите её вручную.'
}
& $adb -s $target shell am start -n com.nocturne.vault/.MainActivity | Out-Null
Write-Host "Nocturne установлен и открыт на устройстве $target."
