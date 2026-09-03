# Nocturne for Android 0.9.11 (29)

## Русский

### Что изменилось

- «Защищённые приложения» вынесены во второй раздел нижнего меню и получили отдельный экран справки.
- Удалены ручные и одноразовые коды переподключения. Связь личной и рабочей копий подтверждается короткоживущей подписанной командой через системный межпрофильный маршрут Android.
- Исправлен цикл переподключения после настройки отдельного кода рабочего пространства. Nocturne ждёт подтверждения Android после возврата из настроек и не показывает ложное состояние «Готово».
- Если прошивка сохранила общий код телефона вместо отдельного рабочего кода, пространство остаётся закрытым и показывает понятное действие для исправления.
- Состояние рабочего профиля обновляется при возврате в приложение и по системным событиям.
- Добавлен добровольно включаемый журнал диагностики без содержимого хранилища и секретов.

### Важно

Основное хранилище поддерживает Android 8.0 и новее. Защищённые приложения требуют Android 11+, поддержки managed profile прошивкой и отдельного PIN, рисунка или пароля рабочего пространства. Это системная изоляция Android, а не виртуальная машина.

Обновление можно установить поверх предыдущей release-версии. Не удаляйте приложение перед обновлением, если у вас нет проверенной резервной копии.

## English

### What changed

- Protected apps now live in the second bottom-navigation destination and have a dedicated Help screen.
- Manual and one-time pairing codes are gone. The personal and managed-profile copies pair through a short-lived signed command delivered by Android's system cross-profile route.
- Fixed the reconnect loop after configuring a separate work-space credential. Nocturne now waits for Android to confirm the change after Settings returns and never reports a false Ready state.
- If the firmware keeps the phone credential unified instead of creating a separate work credential, the space remains closed and shows a clear recovery action.
- Managed-profile state refreshes on app resume and relevant system events.
- Added opt-in diagnostics that exclude vault contents and secrets.

### Important

The core vault supports Android 8.0 and newer. Protected apps require Android 11+, firmware support for managed profiles, and a separate work-space PIN, pattern, or password. This is Android system isolation, not a virtual machine.

Install this release over the previous release build. Do not uninstall the app before updating unless you have a verified backup.

## Verification

- Package: `com.nocturne.vault`
- Version: `0.9.11` (`29`)
- Min / target SDK: `26` / `36`
- APK Signature Scheme: v2 + v3
- APK SHA-256: `EF38EFAAA64BA205AA5C6A52C10EB76C7BB6BA1AF68146A56F9BA460E4D91E44`
- Signing certificate SHA-256: `F70419D3A2BB51D918A697289DE4C9E231F715D06B7F6A953950640BFA6374E4`
