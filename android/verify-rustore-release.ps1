param(
  [Parameter(Mandatory = $true)]
  [string]$ApkPath,
  [string]$ReportPath
)

$ErrorActionPreference = 'Stop'
$expectedPackage = 'com.nocturne.vault'
$expectedVersionName = '0.9.11'
$expectedVersionCode = '29'
$expectedMinSdk = '26'
$expectedTargetSdk = '36'
$expectedCertificateSha256 = 'f70419d3a2bb51d918a697289de4c9e231f715d06b7f6a953950640bfa6374e4'
$sdk = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } elseif ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$analyzer = Join-Path $sdk 'cmdline-tools\latest\bin\apkanalyzer.bat'
$apksigner = Join-Path $sdk 'build-tools\36.0.0\apksigner.bat'

if (-not (Test-Path -LiteralPath $ApkPath)) { throw "APK не найден: $ApkPath" }
if (-not (Test-Path -LiteralPath $analyzer)) { throw "Не найден apkanalyzer: $analyzer" }
if (-not (Test-Path -LiteralPath $apksigner)) { throw "Не найден apksigner: $apksigner" }

$temporaryRoot = Join-Path $env:TEMP "nocturne-rustore-verify-$([Guid]::NewGuid().ToString('N'))"
$resolvedTempParent = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
$resolvedTemporaryRoot = [IO.Path]::GetFullPath($temporaryRoot)
if (-not $resolvedTemporaryRoot.StartsWith($resolvedTempParent, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Временный путь проверки вышел за пределы системного TEMP.'
}

New-Item -ItemType Directory -Path $resolvedTemporaryRoot | Out-Null
$inspectionApk = Join-Path $resolvedTemporaryRoot 'app-release.apk'
try {
  Copy-Item -LiteralPath $ApkPath -Destination $inspectionApk

  $package = (& $analyzer manifest application-id $inspectionApk).Trim()
  $versionName = (& $analyzer manifest version-name $inspectionApk).Trim()
  $versionCode = (& $analyzer manifest version-code $inspectionApk).Trim()
  $minSdk = (& $analyzer manifest min-sdk $inspectionApk).Trim()
  $targetSdk = (& $analyzer manifest target-sdk $inspectionApk).Trim()
  $debuggable = (& $analyzer manifest debuggable $inspectionApk).Trim()
  $permissions = @(& $analyzer manifest permissions $inspectionApk)
  $manifest = @(& $analyzer manifest print $inspectionApk) -join "`n"
  $dexPackages = @(& $analyzer dex packages $inspectionApk) -join "`n"
  $signature = @(& $apksigner verify --verbose --print-certs $inspectionApk)
  if ($LASTEXITCODE -ne 0) { throw 'APK не прошёл проверку цифровой подписи.' }

  if ($package -ne $expectedPackage) { throw "Неожиданный package name: $package" }
  if ($versionName -ne $expectedVersionName) { throw "Неожиданная версия: $versionName" }
  if ($versionCode -ne $expectedVersionCode) { throw "Неожиданный versionCode: $versionCode" }
  if ($minSdk -ne $expectedMinSdk) { throw "Неожиданный minSdk: $minSdk" }
  if ($targetSdk -ne $expectedTargetSdk) { throw "Неожиданный targetSdk: $targetSdk" }
  if ($debuggable -ne 'false') { throw 'Release APK допускает отладку.' }
  if ($permissions -match 'com.google.android.gms.permission.AD_ID') { throw 'В итоговом APK обнаружено разрешение AD_ID.' }
  if ($permissions -match 'android.permission.INTERNET') { throw 'В офлайн-сборке обнаружено разрешение INTERNET.' }
  if ($permissions -match 'android.permission.ACCESS_NETWORK_STATE') { throw 'В офлайн-сборке обнаружено разрешение ACCESS_NETWORK_STATE.' }
  if ($permissions -match 'android.permission.MANAGE_EXTERNAL_STORAGE') { throw 'В итоговом APK обнаружено MANAGE_EXTERNAL_STORAGE.' }
  if (-not ($permissions -match 'android.permission.QUERY_ALL_PACKAGES')) { throw 'Контроллер рабочего профиля не сможет приостанавливать все гостевые приложения.' }
  if (-not ($permissions -match 'android.permission.SCHEDULE_EXACT_ALARM')) { throw 'В итоговом APK отсутствует точный аварийный таймер.' }
  if (-not ($permissions -match 'android.permission.REQUEST_PASSWORD_COMPLEXITY')) { throw 'В итоговом APK отсутствует проверка отдельного кода рабочего профиля для Android 11.' }
  $allowedPermissions = @(
    'android.permission.QUERY_ALL_PACKAGES',
    'android.permission.RECEIVE_BOOT_COMPLETED',
    'android.permission.RECORD_AUDIO',
    'android.permission.REQUEST_PASSWORD_COMPLEXITY',
    'android.permission.SCHEDULE_EXACT_ALARM',
    'android.permission.USE_BIOMETRIC',
    'android.permission.USE_FINGERPRINT',
    'android.permission.WAKE_LOCK',
    'com.nocturne.vault.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'
  )
  $unexpectedPermissions = @($permissions | ForEach-Object { $_.Trim() } | Where-Object { $_ -and $_ -notin $allowedPermissions })
  if ($unexpectedPermissions.Count) { throw "В APK обнаружены неразрешённые разрешения: $($unexpectedPermissions -join ', ')" }
  if ($manifest -notmatch 'android:allowBackup="false"') { throw 'Android Backup не отключён в итоговом манифесте.' }
  if ($manifest -notmatch 'android:usesCleartextTraffic="false"') { throw 'Незашифрованный сетевой трафик не запрещён.' }
  if ($manifest -match 'com\.yandex') { throw 'В итоговом манифесте остались компоненты Yandex.' }
  if ($dexPackages -match 'com\.yandex') { throw 'В итоговом DEX остался код Yandex.' }
  if (-not ($signature -match 'Verified using v2 scheme .*: true')) { throw 'APK не прошёл проверку подписи v2.' }
  if (-not ($signature -match 'Verified using v3 scheme .*: true')) { throw 'APK не прошёл проверку подписи v3.' }
  if (-not ($signature -match [Regex]::Escape($expectedCertificateSha256))) { throw 'APK подписан неизвестным сертификатом.' }

  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ApkPath).Hash
  $size = (Get-Item -LiteralPath $ApkPath).Length
  $result = [PSCustomObject]@{
    Apk = [IO.Path]::GetFullPath($ApkPath)
    Package = $package
    VersionName = $versionName
    VersionCode = $versionCode
    MinSdk = $minSdk
    TargetSdk = $targetSdk
    Debuggable = $debuggable
    SizeBytes = $size
    Sha256 = $hash
    CertificateSha256 = $expectedCertificateSha256.ToUpperInvariant()
    Permissions = ($permissions -join ', ')
    Status = 'READY_FOR_RUSTORE_UPLOAD'
  }
  $result | Format-List
  if ($ReportPath) {
    $resolvedReport = [IO.Path]::GetFullPath($ReportPath)
    New-Item -ItemType Directory -Path (Split-Path -Parent $resolvedReport) -Force | Out-Null
    $result | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $resolvedReport -Encoding utf8
  }
} finally {
  if (Test-Path -LiteralPath $resolvedTemporaryRoot) {
    Remove-Item -LiteralPath $resolvedTemporaryRoot -Recurse -Force
  }
}
