$ErrorActionPreference = 'Stop'
$sdk = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } elseif ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path -LiteralPath $sdk)) { throw 'Android SDK не найден.' }
$env:ANDROID_SDK_ROOT = $sdk
$wrapperPath = Join-Path $PSScriptRoot 'gradle\wrapper\gradle-wrapper.jar'
$expectedWrapperSha256 = '55243ef57851f12b070ad14f7f5bb8302daceeebc5bce5ece5fa6edb23e1145c'
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $wrapperPath).Hash.ToLowerInvariant() -ne $expectedWrapperSha256) {
  throw 'Gradle Wrapper JAR не совпадает с официальной контрольной суммой.'
}
$buildRoot = $PSScriptRoot
$temporaryDrive = $null
if ($PSScriptRoot -match '[^\x00-\x7F]') {
  $usedDrives = [System.IO.DriveInfo]::GetDrives().Name
  $temporaryDrive = @('Z:', 'Y:', 'X:', 'W:', 'V:') | Where-Object { "$($_)\" -notin $usedDrives } | Select-Object -First 1
  if (-not $temporaryDrive) { throw 'Не найден свободный диск для сборки.' }
  & subst.exe $temporaryDrive $PSScriptRoot
  if ($LASTEXITCODE -ne 0) { throw 'Не удалось создать временный диск сборки.' }
  $buildRoot = "$temporaryDrive\"
}
Push-Location -LiteralPath $buildRoot
try {
  & "$buildRoot\gradlew.bat" :app:clean :app:testDebugUnitTest :app:lintRelease :app:assembleRelease --no-daemon --max-workers=1
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
  if ($temporaryDrive) { & subst.exe $temporaryDrive /D | Out-Null }
}
$apk = Join-Path (Split-Path -Parent $PSScriptRoot) 'dist\Nocturne-Vault-Android-0.9.11-release.apk'
$report = Join-Path $PSScriptRoot 'release\release-verification-0.9.11.json'
& (Join-Path $PSScriptRoot 'sign-release.ps1') -OutputPath $apk
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& (Join-Path $PSScriptRoot 'verify-rustore-release.ps1') -ApkPath $apk -ReportPath $report
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Release APK: $apk"
Write-Host "Verification report: $report"
