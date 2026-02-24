## OpenCode version management (Bot + Mini App)

### Что реализовано

- При старте `bot` выполняется фоновая проверка актуальной версии OpenCode.
- В Mini App (`Settings`) добавлена секция версий в `7. General settings`:
  - текущая версия OpenCode,
  - последняя опубликованная версия,
  - индикатор доступности обновления.
- Кнопка `Reload` в Settings теперь обновляет не только overview, но и делает проверку версии.
- Добавлена кнопка `Update OpenCode` рядом с `Restart OpenCode`.

### Backend API

- Bot-facing (admin header):
  - `POST /api/telegram/opencode/version/check`
    - обновляет кэш latest-версии на backend,
    - возвращает `{ currentVersion, latestVersion, latestCheckedAt, updateAvailable }`.

- Mini App (AppAuthGuard):
  - `GET /api/opencode/version/status`
    - возвращает текущую версию и последний известный latest из кэша.
  - `POST /api/opencode/version/check`
    - принудительно обновляет latest из npm registry.
  - `POST /api/opencode/version/update`
    - выполняет обновление OpenCode в контейнере до latest и перезапускает контейнер.

### Runtime поведение

- Текущая версия читается из running-контейнера (`opencode --version`).
- Latest версия читается из npm (`opencode-ai`).
- Обновление выполняется в контейнере через `npm install -g opencode-ai@<latest>` с последующим `docker restart`.

### Что проверить

1. Открыть Mini App → `Settings` → `7. General settings`.
2. Нажать `Reload` и убедиться, что поле `Latest` обновляется.
3. Если `updateAvailable=true`, нажать `Update OpenCode` и дождаться завершения.
4. Проверить, что `OpenCode` версия изменилась, а `updateAvailable` стал `false` (если обновилось до latest).
5. Перезапустить bot и убедиться, что стартовая проверка версии не приводит к ошибкам в логах.
