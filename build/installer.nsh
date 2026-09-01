!macro customInstall
  WriteRegStr HKCU "Software\Classes\*\shell\NocturneVault" "" "Добавить в Nocturne"
  WriteRegStr HKCU "Software\Classes\*\shell\NocturneVault" "MUIVerb" "Добавить в Nocturne"
  WriteRegStr HKCU "Software\Classes\*\shell\NocturneVault" "Icon" "$INSTDIR\Nocturne Vault.exe"
  WriteRegStr HKCU "Software\Classes\*\shell\NocturneVault" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\*\shell\NocturneVault" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\*\shell\NocturneVault\command" "" '"$INSTDIR\Nocturne Vault.exe" --import "%1"'
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "NocturneVault"
  DeleteRegKey HKCU "Software\Classes\*\shell\NocturneVault"
!macroend
