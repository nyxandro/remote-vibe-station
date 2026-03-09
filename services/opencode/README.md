# OpenCode Service

Контейнер с OpenCode в серверном режиме.

Минимальные обязанности:

- Запуск `opencode serve`.
- Предоставление HTTP API и SSE `/event`.
- Доступ к файловой системе проектов через volume.
- Роль общего toolbox-runtime для всех агентных команд и shared CLI-зависимостей.

Дополнительно:

- На старте контейнер генерирует `/root/.config/opencode/opencode.json`, если заданы
  `CLIPROXY_BASE_URL` и `CLIPROXY_API_KEY`.
- Провайдер по умолчанию — `cliproxy` (переопределяется через `CLIPROXY_PROVIDER_ID`).
- Список моделей подгружается динамически из `CLIPROXY_BASE_URL/models`.
- `CLIPROXY_DEFAULT_MODEL_ID` (если задан) валидируется против динамического каталога моделей.
- Shared volume `/toolbox` хранит npm/pipx/uv/playwright installs и кеши между рестартами runtime.
- Структура `/toolbox` закреплена явно: `npm-global`, `pnpm/store`, `pipx`, `python-user`, `playwright`, `cache/npm`, `cache/pip`, `cache/uv`, `bin`.
