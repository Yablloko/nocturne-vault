param(
  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$signingRoot = Join-Path $env:LOCALAPPDATA 'NocturneVault\signing'
$sourceKey = Join-Path $signingRoot 'nocturne-release.p12'
$credentialPath = Join-Path $signingRoot 'nocturne-release.credential.xml'
$alias = 'nocturne-release'
$keytoolCandidates = @(
  $(if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME 'bin\keytool.exe' }),
  'C:\Program Files\Java\jdk-17\bin\keytool.exe'
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$keytool = $keytoolCandidates | Select-Object -First 1

if (-not $keytool) { throw 'Не найден JDK keytool.' }
if (-not (Test-Path -LiteralPath $sourceKey) -or -not (Test-Path -LiteralPath $credentialPath)) {
  throw 'Локальный комплект release-подписи не найден. Сначала выполните sign-release.ps1.'
}

$resolvedSource = [IO.Path]::GetFullPath($sourceKey)
$resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
if ($resolvedSource -eq $resolvedOutput) { throw 'Резервная копия не должна перезаписывать рабочий release-ключ.' }
if ([IO.Path]::GetExtension($resolvedOutput) -ne '.p12') { throw 'Укажите путь к файлу с расширением .p12.' }

$first = Read-Host 'Придумайте пароль резервной копии ключа' -AsSecureString
$second = Read-Host 'Повторите пароль резервной копии ключа' -AsSecureString
$backupPassword = [Net.NetworkCredential]::new('', $first).Password
$backupConfirmation = [Net.NetworkCredential]::new('', $second).Password
if ($backupPassword.Length -lt 16) { throw 'Пароль резервной копии должен содержать не менее 16 символов.' }
if ($backupPassword -cne $backupConfirmation) { throw 'Пароли не совпадают.' }

$credential = Import-Clixml -LiteralPath $credentialPath
$sourcePassword = [Net.NetworkCredential]::new('', $credential.Password).Password
$parent = Split-Path -Parent $resolvedOutput
New-Item -ItemType Directory -Path $parent -Force | Out-Null
$pending = "$resolvedOutput.pending"
$certificatePath = [IO.Path]::ChangeExtension($resolvedOutput, '.pem')

$env:NOCTURNE_SOURCE_KEY_PASSWORD = $sourcePassword
$env:NOCTURNE_BACKUP_KEY_PASSWORD = $backupPassword
try {
  Remove-Item -LiteralPath $pending -Force -ErrorAction SilentlyContinue
  & $keytool -importkeystore -noprompt `
    -srckeystore $sourceKey -srcstoretype PKCS12 -srcalias $alias `
    '-srcstorepass:env' NOCTURNE_SOURCE_KEY_PASSWORD '-srckeypass:env' NOCTURNE_SOURCE_KEY_PASSWORD `
    -destkeystore $pending -deststoretype PKCS12 -destalias $alias `
    '-deststorepass:env' NOCTURNE_BACKUP_KEY_PASSWORD '-destkeypass:env' NOCTURNE_BACKUP_KEY_PASSWORD
  if ($LASTEXITCODE -ne 0) { throw 'Не удалось создать резервную копию release-ключа.' }

  & $keytool -list -keystore $pending -storetype PKCS12 '-storepass:env' NOCTURNE_BACKUP_KEY_PASSWORD -alias $alias | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Проверка резервной копии release-ключа завершилась ошибкой.' }

  & $keytool -exportcert -rfc -alias $alias -keystore $pending -storetype PKCS12 `
    '-storepass:env' NOCTURNE_BACKUP_KEY_PASSWORD -file $certificatePath
  if ($LASTEXITCODE -ne 0) { throw 'Не удалось экспортировать публичный сертификат.' }

  Move-Item -LiteralPath $pending -Destination $resolvedOutput -Force
} finally {
  Remove-Item -LiteralPath $pending -Force -ErrorAction SilentlyContinue
  Remove-Item Env:NOCTURNE_SOURCE_KEY_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:NOCTURNE_BACKUP_KEY_PASSWORD -ErrorAction SilentlyContinue
  $sourcePassword = $null
  $backupPassword = $null
  $backupConfirmation = $null
}

Write-Host "Зашифрованная резервная копия ключа: $resolvedOutput"
Write-Host "Публичный сертификат: $certificatePath"
Write-Host 'Сохраните .p12 и его пароль отдельно от компьютера. Потеря ключа лишит возможности выпускать обновления.'
