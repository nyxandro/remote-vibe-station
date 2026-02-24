# OpenCode Web UI: Telegram Magic-Link Auth

Документ описывает текущую схему доступа к внешнему OpenCode UI без БД.

## Что реализовано

- Доступ к OpenCode UI вынесен на отдельный домен `OPENCODE_PUBLIC_DOMAIN`.
- Прямой host-порт OpenCode не публикуется; трафик идет только через Traefik.
- Перед каждым запросом к OpenCode UI Traefik вызывает `forwardAuth` endpoint бота (`/opencode-auth/check`).
- Вход в UI выполняется через одноразовую ссылку из Telegram команды `/access`.

## Политика TTL

- Magic-link из Telegram: 5 минут, одноразовый.
- Cookie-сессия браузера: 30 дней (`HttpOnly`, `Secure`, `SameSite=Lax`).
- Состояние хранится в JSON-файле `bot_data:/app/data/opencode-web-auth.json`.
- Канал `Traefik -> bot` для `forwardAuth` использует внутреннюю Docker-сеть (`internal`) и не публикуется наружу.

## Ограничение доступа к боту

- Доступ определяется только через `ADMIN_IDS`.
- Чтобы доступ был строго у одного Telegram-аккаунта, укажите один ID в `ADMIN_IDS`.

## Новые переменные окружения

- `OPENCODE_PUBLIC_DOMAIN` - домен OpenCode UI (пример: `code.example.com`).
- `OPENCODE_PUBLIC_BASE_URL` - полный URL OpenCode UI (пример: `https://code.example.com`).

## Поток входа

1. Админ отправляет `/access` в Telegram боту.
2. Бот создает одноразовый токен, сохраняет только hash токена и отправляет ссылку вида:
   `https://code.example.com/opencode-auth/exchange?token=<token>`
3. При переходе по ссылке бот-эндпоинт валидирует токен и ставит cookie сессии.
4. Браузер переходит в `/` OpenCode домена.
5. Traefik проверяет cookie через `/opencode-auth/check` и пускает трафик к OpenCode только при `200 OK`.

## Деплой-проверка

- Проверить DNS для `OPENCODE_PUBLIC_DOMAIN`.
- Выполнить `docker compose up -d --build`.
- Убедиться, что `https://<OPENCODE_PUBLIC_DOMAIN>/` без cookie возвращает `401` или `403`
  (код зависит от поведения `forwardAuth`/Traefik в конкретной версии и настройках).
- Отправить `/access`, открыть ссылку, убедиться что UI открывается.
