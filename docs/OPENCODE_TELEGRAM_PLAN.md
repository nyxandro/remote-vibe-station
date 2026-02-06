# Полная спецификация: Telegram управление OpenCode на VPS

## Цель

Создать инструмент удаленного управления OpenCode через Telegram (чат + Mini App) на выделенном VPS. Сервер выступает как удаленная среда разработки и тестирования: проекты живут на сервере, OpenCode работает с ними локально, а управление ведется из Telegram.

## Ограничение масштаба (1:1:1)

- Это не мультипользовательское приложение.
- Модель: 1 сервер -> 1 экземпляр OpenCode -> 1 Telegram-аккаунт администратора.
- Для сторонних пользователей предоставляется репозиторий и инструкция для самостоятельной установки.

## Текущий приоритет (минимальный сценарий)

- Главное сейчас: стабильное удаленное подключение к OpenCode на сервере через Telegram.
- Mini App и управление проектами остаются в плане, но могут вводиться поэтапно.

## Текущее состояние реализации (на 2026-02-05)

- Проекты обнаруживаются автоматически: каждая подпапка в `PROJECTS_ROOT` считается проектом; `runnable=true` только если в корне проекта есть `docker-compose.yml` или `docker-compose.yaml`.
- Выбор активного проекта хранится на backend и привязан к админскому Telegram user id (можно вести несколько параллельных чатов/сессий по разным админам).
- Mini App умеет: список проектов, файловый браузер + подсветка (Shiki), терминал (PTY), статусы/логи compose.
- Терминал/системные события идут в Mini App через **нативный WebSocket** `WS /events` (не socket.io).
- Telegram чат: вывод агента отправляется в чат только когда включен стриминг (`/chat` включает, `/end` выключает). По умолчанию стриминг выключен.
- Надежная доставка в Telegram: ответы/уведомления попадают в backend outbox (`data/telegram.outbox.json`) и доставляются ботом через polling с lease+retry. При временных проблемах сети сообщения будут переотправлены.
- UX Telegram: при обработке промпта бот показывает одно "thinking" сообщение с анимированными точками и удаляет его перед отправкой первого реального сообщения из outbox.
- Управление стримингом доступно и из Mini App: `POST /api/telegram/stream/start|stop`, статус: `GET /api/telegram/stream/status`.
- Slash-меню Telegram синхронизируется с OpenCode: бот получает список через backend (`GET /api/telegram/commands`) и публикует его через `setMyCommands` вместе с локальными командами (`/start`, `/chat`, `/end`, `/open`, `/projects`, `/project`).
- Для OpenCode-команд с дефисом (`review-changes`) бот публикует Telegram-алиас с подчеркиванием (`/review_changes`) и пробрасывает его обратно в исходное имя команды.
- Неизвестные локальному боту slash-команды пробрасываются в OpenCode через backend (`POST /api/telegram/command`) и выполняются в активном проекте.
- Бот выполняет периодический ресинк slash-меню (каждые 60 секунд), чтобы Telegram-подсказки не устаревали при изменении доступных команд OpenCode.
- Добавлено меню режима в Telegram: reply-кнопка `⚙️ Режим` (и `/mode`) открывает inline-панель выбора `Model` / `Thinking` / `Agent`; выбранные значения сохраняются per-admin на backend.
- Reply-кнопка режима показывает активный проект в компактном виде `⚙️ Режим | <slug>`, чтобы переключение режима и контекст проекта были видны без открытия Mini App.
- Выбранные `model + thinking(variant) + agent` применяются к `POST /api/prompt` (вызовы OpenCode message endpoint).
- Добавлен live-прогресс runtime из OpenCode SSE: в Telegram показываются события выполнения `bash` с обновлением одного сообщения (editMessageText), а также структурированные события изменения файлов (`Создание/Редактирование/Удаление файла ... +N -M`).
- Добавлена поддержка интерактивных вопросов OpenCode (`question` tool): вопрос доставляется в Telegram с inline-кнопками вариантов, ответ пользователя отправляется обратно в OpenCode через backend endpoint.
- Политика уведомлений в Telegram: технические/промежуточные сообщения outbox отправляются тихо (`disable_notification=true`), звуковое уведомление остается только на финальном чанке ответа (без отдельного mention-сообщения).
- События операций с файлами в Telegram теперь форматируются как HTML-сообщение: строка операции в *курсиве* с **жирными** счетчиками `+N/-M`, а путь файла — жирная подчеркнутая ссылка, ведущая в Mini App deep-link `startapp=diff_<token>`.
- Технический footer финального ответа (tokens/%/model/thinking/agent) рендерится как Telegram blockquote, чтобы визуально отделять отладочную строку от основного текста.
- Mini App поддерживает открытие полноэкранного diff-preview по deep-link токену (`tgWebAppStartParam` / `start_param`) и загружает diff через backend endpoint `GET /api/telegram/diff-preview/:token`.
- Browser-режим Mini App (вне Telegram): бот `/open` выдает ссылку с подписью `#token=...`; Mini App отправляет `Authorization: Bearer <token>`.

## Не цели (на текущем этапе)

- Мультипользовательский режим и ролевая модель.
- Публичный каталог проектов или публичные ссылки.
- Продакшн-хостинг клиентов с SLA.

## Допущения

- VPS под Linux, доступ root или sudo.
- Домен и wildcard DNS доступны.
- Telegram аккаунт администратора известен заранее.
- Все проекты являются тестовыми/внутренними.

## Режимы работы OpenCode

- OpenCode построен как клиент-сервер: при запуске `opencode` поднимается локальный HTTP сервер, а TUI выступает клиентом.
- Серверный режим: `opencode serve` (headless HTTP API) или `opencode web` (сервер + web UI).
- Клиентский режим: TUI, IDE, web-клиент и `opencode attach` подключаются к уже запущенному серверу.
- В нашей схеме OpenCode всегда работает в серверном режиме внутри Docker сети.
- Backend использует HTTP API и SSE `/event` для событий.
- Если OpenCode сервер доступен извне, включаем Basic Auth через `OPENCODE_SERVER_PASSWORD`.

## Архитектура системы

Система состоит из пяти компонентов в Docker контейнерах:

1. **OpenCode Service**: серверный режим OpenCode (`opencode serve`).
2. **Backend (Middleware)**: NestJS. Управляет OpenCode, проектами, API, WebSocket.
3. **Telegram Bot**: чат-интерфейс, отправка сообщений и команд.
4. **Mini App (Frontend)**: интерфейс управления, дерево файлов, терминал, статусы.
5. **Reverse Proxy**: Traefik + Let's Encrypt. Публичный HTTPS и WSS.

## Модель взаимодействия (чат + Mini App)

- Чат Telegram - основной канал управления: промпты и полный поток сообщений OpenCode.
- Mini App - панель управления: дерево файлов, терминал, настройки, статусы Docker.
- Оба канала работают с одной активной сессией и общей очередью команд.

## Потоки событий

- Backend принимает команды и транслирует события в чат и Mini App.
- Backend использует OpenCode HTTP API для работы с сессиями и промптами.
- Чат получает текстовые сообщения только когда стрим включен (chunking под лимиты Telegram остается обязательным).
- Mini App получает поток через WebSocket (лог + структурированные события).
- При переподключении Mini App получает последние N событий из буфера.

## Домены проектов и поддомены

- Нужен wildcard DNS: `*.<domain.tld>` и `<domain.tld>` указывают на IP VPS.
- Каждый проект получает поддомен: `project1.<domain.tld>`, `project2.<domain.tld>`.
- Traefik маршрутизирует трафик по `Host()` на контейнер проекта.
- Все проектные поддомены закрыты от индексации:
  - middleware Traefik добавляет `X-Robots-Tag: noindex, nofollow, noarchive`;
  - по возможности отдавать `robots.txt` с `Disallow: /`.
- Ссылка на проект работает только пока контейнеры запущены.

## Хранилище проектов на сервере

- Корень проектов: `/srv/projects`.
- Каждый проект - отдельная папка.
- Внутри проекта хранится `docker-compose.yml` (основной) и `opencode.project.json` (метаданные).
- OpenCode контейнер монтирует корень проектов в режиме read/write.

## Управление проектами и контейнерами

- Backend получает доступ к Docker API через `/var/run/docker.sock`.
- Каждый проект управляется через `docker compose -p <slug>`.
- Доступ к операциям ограничен только зарегистрированными проектами и корнем `PROJECTS_ROOT`.

## Безопасность и доступ

- Доступ только для `ADMIN_IDS` + проверка подписи `initData` в Mini App.
- Файловый доступ ограничен корнем выбранного проекта.
- Маскирование токенов/секретов в выводе до отправки в Telegram.
- Все команды логируются с `userId`, `sessionId`, `timestamp`.

## Сессии и очередь

- Одна активная сессия OpenCode.
- Команды сериализуются в очередь.
- Управляющие команды: `/status`, `/cancel`, `/restart`.
- При падении процесса очередь блокируется до явного перезапуска.

## Терминал и файловый доступ

- Терминал через PTY over WebSocket.
- File Tree: список, открытие, поиск, просмотр диффов.
- Запрещены операции вне корня проекта и path traversal (`../`).

## Функциональные требования

### Telegram Bot

- Прием промптов, отправка полного потока ответов.
- Команды: `/start`, `/open`, `/mode`, `/chat`, `/end`, `/projects`, `/project <slug>` + все доступные slash-команды OpenCode.
- Chunking (4096 лимит), batching (рейт лимиты).
- Отправка файлов/логов как документы.

### Mini App

- Аутентификация через Telegram initData.
- Дерево файлов, просмотр содержимого, поиск.
- Терминал: ввод/вывод, статусы.
- Управление проектами: запуск, остановка, перезапуск, просмотр логов.
- Статусы Docker контейнеров.
- Ссылки на поддомены проектов.

### Backend

- Управление OpenCode API и SSE `/event`.
- Очередь команд и буфер событий.
- Docker управление проектами (compose start/stop/restart/status/logs).
- API для Mini App и Bot.

### OpenCode Service

- Запуск в режиме `opencode serve --hostname 0.0.0.0 --port 4096`.
- OpenAPI доступен по `/doc`.
- События доступны по SSE `/event`.

## Нефункциональные требования

- HTTPS обязателен для webhook и Mini App.
- Контроль доступа только для админа.
- Логи и ошибки сохраняются в отдельном volume.
- Отказоустойчивость: сервисы поднимаются через Docker Compose.

## Ограничения Telegram

- Лимит 4096 символов на сообщение - обязательный chunking.
- Рейт-лимиты - batching событий и ограничение частоты отправки.
- Большие логи и файлы отправляются документами.

## Ошибки, логирование, аудит

- Все ошибки логируются с уровнем `error` и структурированным контекстом.
- Ошибки из доменной логики не поглощаются, а пробрасываются наверх.
- В каждый лог включать `userId`, `sessionId`, `requestId`.

## Архитектурная схема (текстовая)

```
[Telegram Chat]          [Telegram Mini App]
        |                        |
        v                        v
   [Telegram Bot]       [Mini App (Web)]
        |                        |
        +-----------+------------+
                    v
             [Backend API]
                    |
         +----------+----------+
         v                     v
  [OpenCode Server]     [Docker API]
         |                     |
         v                     v
   [Project Files]      [Project Containers]
```

## API спецификация (Backend)

### Авторизация

- Mini App: либо `x-telegram-init-data` (Telegram WebApp initData), либо `Authorization: Bearer <signed token>` (browser-режим через `/open`).
- Bot: внутренние вызовы в backend защищены `ADMIN_IDS` (через заголовок админки).

### Промпты и события

- `POST /api/prompt` - отправка промпта.
- `WS /events` - поток событий (лог, status, error, fileTree, terminal).

### Проекты

- `GET /api/projects` - список проектов.
- `GET /api/projects/active` - текущий выбранный проект (per-admin).
- `POST /api/projects/:id/select` - выбрать проект.
- `POST /api/projects/:id/start` - запуск проекта.
- `POST /api/projects/:id/stop` - остановка проекта.
- `POST /api/projects/:id/restart` - перезапуск проекта.
- `GET /api/projects/:id/status` - статус контейнеров.
- `GET /api/projects/:id/logs` - последние логи запуска.
- `GET /api/projects/:id/files?path=<relative>` - список файлов/папок.
- `GET /api/projects/:id/file?path=<relative>` - чтение текстового файла.

### Терминал

- `POST /api/projects/:id/terminal/input` - ввод в PTY выбранного проекта.

### Telegram стрим

- Mini App: `GET /api/telegram/stream/status`, `POST /api/telegram/stream/start`, `POST /api/telegram/stream/stop`.
- Bot (служебные): `POST /api/telegram/bind`, `POST /api/telegram/stream/on`, `POST /api/telegram/stream/off`.
- Bot (slash/OpenCode): `GET /api/telegram/commands` (список OpenCode команд), `POST /api/telegram/command` (выполнение slash-команды OpenCode).
- Bot (режим): `GET /api/telegram/settings`, `POST /api/telegram/settings`, `GET /api/telegram/settings/models?providerID=...`.
- Bot (вопросы OpenCode): `POST /api/telegram/question/reply`.
- Mini App (diff preview): `GET /api/telegram/diff-preview/:token`.

### Telegram outbox (надежная доставка)

- Bot polling: `GET /api/telegram/outbox/pull?limit=<n>` + `POST /api/telegram/outbox/report`.
- Хранилище: `data/telegram.outbox.json` (volume backend).

## Схема событий (WS `/events`)

Все события идут как JSON с единым envelope:

```json
{
  "type": "event.type",
  "ts": "2026-02-05T12:00:00Z",
  "requestId": "req_123",
  "data": {}
}
```

Минимальный набор типов:

- `opencode.message` - текстовое сообщение из OpenCode.
- `opencode.status` - состояние сессии.
- `terminal.output` - вывод PTY.
- `project.status` - статус контейнеров проекта.
- `project.logs` - последние логи.
- `error` - ошибка Backend или OpenCode.

Пример `project.status`:

```json
{
  "type": "project.status",
  "ts": "2026-02-05T12:00:00Z",
  "requestId": "req_456",
  "data": {
    "projectId": "proj_1",
    "slug": "project1",
    "containers": [
      { "name": "app", "state": "running", "ports": ["3000:3000"] }
    ]
  }
}
```

## Реестр проектов (данные)

- Текущее хранение (реализовано): JSON store в volume для выбора активного проекта и состояния стрима Telegram.
- Реестр проектов (план): SQLite/JSON с метаданными проекта (service/port/domain).
- Ограничение: все `rootPath` внутри `PROJECTS_ROOT`.

## Формат проекта

### Файл `opencode.project.json`

- Шаблоны доступны в `templates/project`.
- Файл хранится внутри папки проекта.

Примечание: это часть плана. В текущей реализации проекты обнаруживаются по папкам в `PROJECTS_ROOT` без обязательного `opencode.project.json`.

```json
{
  "name": "Project One",
  "slug": "project1",
  "composePath": "/srv/projects/project1/docker-compose.yml",
  "serviceName": "app",
  "servicePort": <service_port>,
  "domain": "<slug>.<domain.tld>"
}
```

Комментарии:

- `<service_port>` - placeholder, заменить на внутренний порт сервиса.
- `slug` должен быть DNS-safe (a-z, 0-9, `-`).
- `domain` строится по шаблону `<slug>.<domain.tld>`.

## Traefik: поддомены проектов

- Backend генерирует override файл с labels и сетью `public`.
- Запуск: `docker compose -f <composePath> -f <overridePath> -p <slug> up -d`.

Пример `docker-compose.override.yml` (шаблон):

```yaml
services:
  app:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.<slug>.rule=Host(`<slug>.<domain.tld>`)"
      - "traefik.http.routers.<slug>.entrypoints=websecure"
      - "traefik.http.routers.<slug>.tls.certresolver=le"
      - "traefik.http.routers.<slug>.middlewares=noindex-headers@file"
      - "traefik.http.services.<slug>.loadbalancer.server.port=<service_port>"
    networks:
      - public

networks:
  public:
    external: true
```

## Управление проектом из Mini App

- Статус: `docker compose -p <slug> ps`.
- Запуск: `docker compose -p <slug> up -d`.
- Перезапуск: `docker compose -p <slug> restart`.
- Остановка: `docker compose -p <slug> stop` (без `down`).
- Логи: `docker compose -p <slug> logs --tail <N>`.

## Интеграция Telegram

- Бот регистрируется через `@BotFather`.
- Webhook: `https://<domain.tld>/bot/webhook`.
- Mini App URL: `https://<domain.tld>/miniapp`.
- В чате используется кнопка `Open` с WebApp, чтобы открывать Mini App.
- Проверка `initData` обязательна на Backend.

## Развертывание (VPS)

### 1. Подготовка VPS

- Установить Docker и Docker Compose plugin.
- Создать каталоги:
  - `/srv/opencode`
  - `/srv/projects`
  - `/srv/opencode/traefik/acme.json` (права `600`).

### 2. DNS

- `A` запись `<domain.tld>` -> IP VPS.
- `A` запись `*.<domain.tld>` -> IP VPS.

### 3. Запуск стека

- Скопировать `.env.example` -> `.env`.
- Заполнить обязательные значения.
- Запустить `docker compose up -d` из `/srv/opencode`.

## Обязательные переменные окружения

- `TELEGRAM_BOT_TOKEN` - токен бота.
- `TELEGRAM_MINIAPP_SHORT_NAME` - short name Mini App из BotFather (опционально, используется для Telegram deep-link на diff preview).
- `ADMIN_IDS` - список ID администраторов.
- `PUBLIC_BASE_URL` - базовый URL (https).
- `PUBLIC_DOMAIN` - домен без схемы.
- `TLS_EMAIL` - email для Let's Encrypt.
- `PROJECTS_ROOT` - корень проектов на VPS.
- `OPENCODE_SERVER_URL` - URL OpenCode внутри Docker сети.

Опционально:

- `OPENCODE_SERVER_PASSWORD` и `OPENCODE_SERVER_USERNAME` - Basic Auth для OpenCode.
- `BACKEND_URL` - URL backend для Telegram bot (обычно `http://backend:3000`).

## Шаблоны конфигурации

- Базовые файлы в корне репозитория:
  - `.env.example`
  - `docker-compose.yml`
  - `infra/traefik/traefik.yml`
  - `infra/traefik/dynamic/noindex.yml`
- Шаблон проекта:
  - `templates/project/docker-compose.yml`
  - `templates/project/opencode.project.json`

## Тестирование

- Unit: проверка initData, валидация путей, docker wrapper, клиент OpenCode API.
- Integration: запуск/остановка проекта через compose в изолированной среде.
- E2E: сценарий Telegram -> Backend -> OpenCode.
- UI: Playwright проверка Mini App и статусов.

## Приемочные критерии

- Бот принимает промпт и возвращает полный поток ответа.
- Мини App показывает дерево файлов и терминал.
- Проект запускается из Mini App и доступен по `https://<slug>.<domain.tld>`.
- Поддомены проектов имеют `X-Robots-Tag: noindex`.
- Статусы Docker контейнеров доступны в UI.

## План действий

1. **Архитектура**: утвердить схему Docker Compose и модель проектов.
2. **DNS**: настроить домен и wildcard поддомены.
3. **Traefik**: конфиг и noindex middleware.
4. **OpenCode**: запуск `opencode serve` и подключение Backend.
5. **Backend**: очередь, события, Docker управление.
6. **Bot**: webhook и команды.
7. **Mini App**: UI и статусы Docker.
8. **Тесты**: проверка на чистой машине.
