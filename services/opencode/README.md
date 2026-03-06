# OpenCode Service

Контейнер с OpenCode в серверном режиме.

Минимальные обязанности:

- Запуск `opencode serve`.
- Предоставление HTTP API и SSE `/event`.
- Доступ к файловой системе проектов через volume.

Дополнительно:

- На старте контейнер генерирует `/root/.config/opencode/opencode.json`, если заданы
  `CLIPROXY_BASE_URL` и `CLIPROXY_API_KEY`.
- Провайдер по умолчанию — `cliproxy` (переопределяется через `CLIPROXY_PROVIDER_ID`).
- Список моделей подгружается динамически из `CLIPROXY_BASE_URL/models`.
- `CLIPROXY_DEFAULT_MODEL_ID` (если задан) валидируется против динамического каталога моделей.
