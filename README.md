# Remote Vibe Station

Remote Vibe Station - это удаленная dev-среда для работы с OpenCode через Telegram.

Она задумана для сценария, когда стек ставится на внешний сервер и дальше с ним работают удаленно без локального компьютера: например с телефона через Telegram, Mini App и внешний OpenCode в браузере. Основной режим - управление целиком через Telegram. Если нужен большой экран, в любой момент можно открыть OpenCode или Mini App UI в браузере.

Проект поднимает стек из нескольких сервисов в Docker Compose:

- `bot` - Telegram-бот для команд, уведомлений и входа во внешний OpenCode.
- `backend` - API и orchestration-слой между Telegram, Mini App, OpenCode и Docker runtime.
- `miniapp` - Telegram Mini App для управления проектами, сессиями, deploy и настройками.
- `opencode` - web/agent runtime для работы с кодом.
- `proxy` - reverse proxy на Traefik.
- `cliproxy` - прокси для CLI/API-моделей.

## Что умеет

- запускать удаленную среду одной командой;
- управлять проектами и активной директорией из Telegram и Mini App;
- создавать и переключать OpenCode-сессии;
- открывать внешний OpenCode по одноразовой ссылке;
- пересылать в Telegram обычные ответы, прогресс тулов, terminal output, todo и запросы подтверждений;
- запускать и обновлять docker-based deploy на сервере.

## Как устроено

- `services/backend` - NestJS backend;
- `services/bot` - Telegram-бот на Telegraf;
- `services/miniapp` - React + Vite Mini App;
- `services/opencode` - контейнер OpenCode;
- `scripts/install-runtime.sh` - установка image-only runtime на сервер;
- `docs/runtime-install.md` - подробная инструкция по runtime-установке.

## Установка

Рекомендуемый вариант - image-only runtime на сервере:

```bash
curl -fsSL https://raw.githubusercontent.com/nyxandro/remote-vibe-station/master/scripts/bootstrap-runtime.sh | sudo bash -s -- --bot-token "<TELEGRAM_BOT_TOKEN>" --admin-id "<TELEGRAM_ADMIN_ID>" --domain auto --tls-email "<YOUR_EMAIL>"
```

Что делает скрипт:

- ставит Docker и системные зависимости;
- создает runtime-конфиг и секреты;
- настраивает firewall и базовую защиту;
- поднимает сервисы через Docker Compose.

Подробности: `docs/runtime-install.md`.

## Настройка

Минимально нужны:

- Telegram bot token;
- Telegram admin id;
- домен или `auto` для `sslip.io`;
- email для Let's Encrypt.

После установки runtime-конфиг обычно лежит в `/opt/remote-vibe-station-runtime`.

Важно: это не checkout исходников проекта. Исходники репозитория на сервер не копируются. В runtime-директории лежат только compose-файлы, `.env`, proxy/config файлы и служебные скрипты. Сами сервисы запускаются из Docker-образов.

Ключевые файлы:

- `/opt/remote-vibe-station-runtime/.env` - образа и переменные окружения;
- `/opt/remote-vibe-station-runtime/docker-compose.yml` - основной compose;
- `/opt/remote-vibe-station-runtime/docker-compose.vless.yml` - optional override для VLESS;
- `/opt/remote-vibe-station-runtime/infra/` - proxy и related configs.

## Как пользоваться

Базовый сценарий:

1. Открыть бота и привязать admin chat.
2. Выбрать проект в Mini App или через Telegram-команды.
3. Начать новую OpenCode-сессию или продолжить текущую.
4. Работать через Telegram или открыть внешний OpenCode по ссылке `/access`.
5. При необходимости запускать deploy и обновлять runtime-образы.

Что видно в Telegram:

- обычные текстовые сообщения ассистента;
- прогресс команд и файловых изменений;
- todo updates;
- permission/question prompts;
- служебные уведомления по проекту и runtime.

## Локальная разработка

Сервисы запускаются отдельно:

```bash
# backend
cd services/backend && npm install && npm run start:dev

# bot
cd services/bot && npm install && npm run start:dev

# miniapp
cd services/miniapp && npm install && npm run dev
```

Проверка:

```bash
cd services/backend && npm test
cd services/bot && npm test
cd services/miniapp && npm test
```

## Деплой обновлений

В штатной production-конфигурации push в `master` автоматически запускает два workflow:

- `Build And Publish Images` - собирает и публикует свежие образы в GHCR;
- `Deploy Runtime` - после успешной сборки подключается к runtime по SSH, делает `docker compose pull` и `docker compose up -d --remove-orphans`.

Ручной rollout через SSH нужен только как аварийный fallback, если автодеплой временно недоступен. Тогда на сервере достаточно:

```bash
cd /opt/remote-vibe-station-runtime
docker compose --env-file .env -f docker-compose.yml -f docker-compose.vless.yml pull
docker compose --env-file .env -f docker-compose.yml -f docker-compose.vless.yml up -d --remove-orphans
```

Если в `.env` используются SHA-теги вместо `latest`, сначала обновите `RVS_BACKEND_IMAGE`, `RVS_MINIAPP_IMAGE`, `RVS_BOT_IMAGE` и `RVS_OPENCODE_IMAGE`.
