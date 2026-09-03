param(
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$unsignedApk = Join-Path $PSScriptRoot 'app\build\outputs\apk\release\app-release-unsigned.apk'
$sdk = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } elseif ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$apksigner = Join-Path $sdk 'build-tools\37.0.0\apksigner.bat'
$zipalign = Join-Path $sdk 'build-tools\37.0.0\zipalign.exe'
$expectedCertificateSha256 = 'f70419d3a2bb51d918a697289de4c9e231f715d06b7f6a953950640bfa6374e4'

if (-not $OutputPath) { $OutputPath = Join-Path $projectRoot 'dist\Nocturne-Vault-Android-0.9.11-release.apk' }
if (-not (Test-Path -LiteralPath $unsignedApk)) { throw 'Сначала выполните :app:assembleRelease.' }
if (-not (Test-Path -LiteralPath $apksigner)) { throw "Не найден apksigner: $apksigner" }
if (-not (Test-Path -LiteralPath $zipalign)) { throw "Не найден zipalign: $zipalign" }

$signingRoot = Join-Path $env:LOCALAPPDATA 'NocturneVault\signing'
$keystorePath = Join-Path $signingRoot 'nocturne-release.p12'
$credentialPath = Join-Path $signingRoot 'nocturne-release.credential.xml'
$alias = 'nocturne-release'
New-Item -ItemType Directory -Path $signingRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path -Parent $OutputPath) -Force | Out-Null
$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $signingRoot /inheritance:r /grant:r "${currentIdentity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Не удалось ограничить доступ к каталогу release-ключа.' }

if ((Test-Path -LiteralPath $keystorePath) -xor (Test-Path -LiteralPath $credentialPath)) {
  throw 'Неполный комплект подписи. Не удаляйте ключ или DPAPI-файл отдельно.'
}

if (-not (Test-Path -LiteralPath $keystorePath)) { throw 'Постоянный release-ключ отсутствует. Подписание остановлено, новый ключ автоматически не создаётся.' }

$credential = Import-Clixml -LiteralPath $credentialPath
$password = [Net.NetworkCredential]::new('', $credential.Password).Password
$env:NOCTURNE_SIGNING_PASSWORD = $password
$temporaryOutput = "$OutputPath.pending"
try {
  & $zipalign -c -P 16 4 $unsignedApk
  if ($LASTEXITCODE -ne 0) { throw 'Release APK не прошёл проверку zipalign.' }
  Remove-Item -LiteralPath $temporaryOutput -Force -ErrorAction SilentlyContinue
  & $apksigner sign --ks $keystorePath --ks-key-alias $alias --ks-pass env:NOCTURNE_SIGNING_PASSWORD --key-pass env:NOCTURNE_SIGNING_PASSWORD --out $temporaryOutput $unsignedApk
  if ($LASTEXITCODE -ne 0) { throw 'Не удалось подписать release APK.' }
  $verification = @(& $apksigner verify --verbose --print-certs $temporaryOutput)
  if ($LASTEXITCODE -ne 0) { throw 'Подпись release APK не прошла проверку.' }
  if (-not ($verification -match 'Verified using v2 scheme .*: true')) { throw 'APK не подписан схемой v2.' }
  if (-not ($verification -match 'Verified using v3 scheme .*: true')) { throw 'APK не подписан схемой v3.' }
  if (-not ($verification -match [Regex]::Escape($expectedCertificateSha256))) { throw 'APK подписан неизвестным сертификатом.' }
  $verification | Write-Host
  Move-Item -LiteralPath $temporaryOutput -Destination $OutputPath -Force
} finally {
  Remove-Item -LiteralPath $temporaryOutput -Force -ErrorAction SilentlyContinue
  Remove-Item Env:NOCTURNE_SIGNING_PASSWORD -ErrorAction SilentlyContinue
  $password = $null
}

Write-Host "Release APK: $OutputPath"
Write-Host "Signing key: $keystorePath"
