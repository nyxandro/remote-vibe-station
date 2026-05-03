# Runtime Install

Эта инструкция описывает установку Remote Vibe Station на сервер без копирования исходников проекта. На сервер попадает только runtime-директория с `.env`, Compose-файлами и инфраструктурными конфигами. Сервисы запускаются из заранее опубликованных Docker images.

## Что Получится

- Traefik принимает внешний HTTPS-трафик на `80/443` и выпускает Let's Encrypt сертификаты.
- `backend`, `miniapp`, `bot`, `opencode` и `cliproxy` запускаются через Docker Compose.
- OpenCode работает из image `RVS_OPENCODE_IMAGE` и хранит состояние в Docker volumes.
- Проекты агентов лежат в host-директории `PROJECTS_ROOT`, по умолчанию `/srv/projects`.
- OpenCode runtime запускается как доверенный admin-agent: у него есть Docker socket, `/hostfs`, host PID namespace и команда `rvs-host` для установки пакетов/настройки сервера без ручного SSH.
- Telegram bot на production runtime по умолчанию стартует в webhook-режиме.
- VLESS по умолчанию выключен: `docker-compose.vless.yml` создаётся как no-op override.

## Требования

- Ubuntu/Debian-compatible сервер с root/sudo доступом.
- Публичный домен, который указывает на сервер, или `--domain auto` для `sslip.io`.
- Email для Let's Encrypt.
- Telegram bot token из BotFather.
- Telegram admin id.
- Доступ сервера к Docker registry с опубликованными images.

По умолчанию installer использует images:

```text
ghcr.io/nyxandro/remote-vibe-station-backend:latest
ghcr.io/nyxandro/remote-vibe-station-miniapp:latest
ghcr.io/nyxandro/remote-vibe-station-bot:latest
ghcr.io/nyxandro/remote-vibe-station-opencode:latest
eceasy/cli-proxy-api:latest
```

Если GHCR images приватные, перед установкой нужен доступ к registry или последующий `docker login ghcr.io` на сервере.

## Быстрая Установка

Рекомендуемый способ: скачать bootstrap-скрипт напрямую из GitHub и передать параметры installer-а.

```bash
curl -fsSL https://raw.githubusercontent.com/nyxandro/remote-vibe-station/master/scripts/bootstrap-runtime.sh | sudo bash -s -- \
  --bot-token "<TELEGRAM_BOT_TOKEN>" \
  --admin-id "<TELEGRAM_ADMIN_ID>" \
  --domain "example.com" \
  --tls-email "ops@example.com"
```

Для тестового сервера без домена можно использовать auto-domain:

```bash
curl -fsSL https://raw.githubusercontent.com/nyxandro/remote-vibe-station/master/scripts/bootstrap-runtime.sh | sudo bash -s -- \
  --bot-token "<TELEGRAM_BOT_TOKEN>" \
  --admin-id "<TELEGRAM_ADMIN_ID>" \
  --domain auto \
  --tls-email "ops@example.com"
```

В режиме `--domain auto` installer определит публичный IPv4 и создаст домены вида:

```text
<ip>.sslip.io
code.<ip>.sslip.io
```

## Что Делает Bootstrap

`scripts/bootstrap-runtime.sh` не клонирует репозиторий. Он скачивает во временную папку только install-assets:

- `scripts/install-runtime.sh`
- `scripts/install-runtime-preflight.sh`
- `scripts/runtime-installer-lib.sh`
- `scripts/templates/runtime-docker-compose.yml`
- `scripts/templates/runtime-docker-compose.vless.yml`
- `scripts/templates/vless-proxy.env`
- `scripts/templates/vless-xray.json`

После этого bootstrap запускает `install-runtime.sh` с теми аргументами, которые вы передали.

## Что Делает Installer

`scripts/install-runtime.sh` выполняет полный image-only setup:

- устанавливает базовые пакеты: `ca-certificates`, `curl`, `git`, `iproute2`, `jq`, `openssl`, `ufw`, `fail2ban`;
- ставит GitHub CLI best-effort: если пакет `gh` недоступен в apt, runtime продолжает установку без host-level `gh auth`;
- устанавливает Docker через официальный convenience script, если Docker отсутствует;
- создаёт runtime-директорию, по умолчанию `/opt/remote-vibe-station-runtime`;
- создаёт project root, по умолчанию `/srv/projects`;
- генерирует `.env` со всеми runtime variables и секретами;
- копирует Compose templates и infra configs;
- создаёт Traefik dynamic middleware для OpenCode forward-auth и noindex headers;
- создаёт CLIProxy config с сгенерированным API key;
- включает Docker log rotation;
- включает key-only SSH hardening, если на сервере уже есть authorized SSH keys;
- настраивает UFW для `22`, `80`, `443`;
- включает `fail2ban` для `sshd`;
- создаёт systemd timer для безопасной Docker cleanup;
- запускает `docker compose pull` и `docker compose up -d --remove-orphans`.

Installer не пишет исходный код проекта на сервер.

## Права Агента

Runtime рассчитан на личный remote-dev сервер, где агенту доверяют администрирование окружения. Контейнер `opencode` может:

- запускать Docker и Docker Compose через host Docker socket;
- читать и менять host filesystem через `/hostfs`;
- выполнять host-команды через `rvs-host <command>`;
- использовать host SSH/GitHub CLI state для git/ssh операций;
- сохранять установленные CLI, MCP tooling, Playwright browsers и caches в persistent volume `/toolbox`.

Примеры:

```bash
rvs-host apt-get update
rvs-host apt-get install -y imagemagick
npx playwright install chromium
```

Такой режим намеренно даёт агенту широкие права, чтобы он мог сам доустанавливать инструменты и деплоить проекты на текущем сервере.

## Сгенерированные Файлы

Runtime-директория выглядит так:

```text
/opt/remote-vibe-station-runtime/
├── .env
├── docker-compose.yml
├── docker-compose.vless.yml
├── runtime-maintenance.sh
└── infra/
    ├── cliproxy/config.yaml
    ├── traefik/traefik.yml
    ├── traefik/acme.json
    ├── traefik/dynamic/noindex.yml
    ├── traefik/dynamic/opencode-auth.yml
    └── vless/
        ├── proxy.env
        └── xray.json
```

Важные файлы:

- `.env` - runtime secrets, domains, image refs and project paths.
- `docker-compose.yml` - основной image-only Compose stack.
- `docker-compose.vless.yml` - optional proxy override. На свежей установке это `services: {}`.
- `infra/vless/proxy.env` - пустые proxy variables на свежей установке.
- `infra/vless/xray.json` - disabled direct config на свежей установке.

## Runtime Переменные

Installer генерирует и записывает в `.env`:

```text
COMPOSE_PROJECT_NAME=remote-vibe-station
TELEGRAM_BOT_TOKEN=<provided>
ADMIN_IDS=<provided>
PUBLIC_BASE_URL=https://<domain>
PUBLIC_DOMAIN=<domain>
OPENCODE_PUBLIC_BASE_URL=https://<opencode-domain>
OPENCODE_PUBLIC_DOMAIN=<opencode-domain>
PROJECTS_ROOT=/srv/projects
RVS_RUNTIME_VERSION=<version-or-image-tag>
RVS_RUNTIME_COMMIT_SHA=<source-commit-sha>
BOT_BACKEND_AUTH_TOKEN=<generated>
OPENCODE_SERVER_PASSWORD=<generated>
CLIPROXY_API_KEY=<generated>
CLIPROXY_MANAGEMENT_PASSWORD=<generated>
RVS_BACKEND_IMAGE=<image>
RVS_MINIAPP_IMAGE=<image>
RVS_BOT_IMAGE=<image>
RVS_OPENCODE_IMAGE=<image>
RVS_CLIPROXY_IMAGE=<image>
```

Telegram transport mode не обязан быть в `.env`. Runtime Compose default:

```text
TELEGRAM_TRANSPORT_MODE=webhook
```

Если нужно временно перейти на polling, добавьте в `.env`:

```text
TELEGRAM_TRANSPORT_MODE=polling
```

Затем примените stack:

```bash
cd /opt/remote-vibe-station-runtime
docker compose --env-file .env -f docker-compose.yml -f docker-compose.vless.yml up -d --remove-orphans bot
```

## Кастомные Images

Любой image можно переопределить при установке:

```bash
sudo ./scripts/install-runtime.sh \
  --bot-token "<TELEGRAM_BOT_TOKEN>" \
  --admin-id "<TELEGRAM_ADMIN_ID>" \
  --domain "example.com" \
  --tls-email "ops@example.com" \
  --backend-image "ghcr.io/org/backend:tag" \
  --miniapp-image "ghcr.io/org/miniapp:tag" \
  --bot-image "ghcr.io/org/bot:tag" \
  --opencode-image "ghcr.io/org/opencode:tag"
```

Для установки всех RVS-сервисов с одним tag используйте:

```bash
sudo ./scripts/install-runtime.sh \
  --bot-token "<TELEGRAM_BOT_TOKEN>" \
  --admin-id "<TELEGRAM_ADMIN_ID>" \
  --domain "example.com" \
  --tls-email "ops@example.com" \
  --runtime-version "v1.2.3" \
  --runtime-commit-sha "<commit-sha>" \
  --image-tag "v1.2.3"
```

## Preflight

Перед запуском stack installer выполняет `scripts/install-runtime-preflight.sh`.

Проверяется:

- runtime-директория доступна на запись;
- `PROJECTS_ROOT` доступен на запись;
- `PUBLIC_DOMAIN` и `OPENCODE_PUBLIC_DOMAIN` резолвятся в IPv4;
- домены указывают на текущий public IPv4 сервера;
- порты `80` и `443` свободны;
- Compose config валиден вместе с no-op VLESS override.

Если нужно сознательно пропустить эти проверки:

```bash
sudo ./scripts/install-runtime.sh ... --skip-preflight
```

## Dry Run

Dry run генерирует runtime files без установки пакетов, firewall changes и запуска Docker:

```bash
./scripts/install-runtime.sh \
  --dry-run \
  --install-dir /tmp/rvs-runtime \
  --bot-token "123:token" \
  --admin-id "100500" \
  --domain "example.com" \
  --tls-email "ops@example.com"
```

Проверочный тест installer-а:

```bash
bash scripts/tests/install-runtime.test.sh
```

## VLESS

На свежей установке VLESS выключен, но файлы уже подготовлены. Это сделано специально, потому что installer не должен стартовать `vless-proxy` с placeholder credentials.

Правильный flow:

1. Откройте Mini App.
2. Перейдите в Providers / CLIProxy runtime settings.
3. Выберите `vless`.
4. Вставьте реальный `vless://...` config URL.
5. Нажмите test/save.
6. Нажмите `Apply runtime now`.

Backend перепишет:

- `infra/vless/proxy.env`
- `infra/vless/xray.json`
- `docker-compose.vless.yml`

После этого Compose поднимет `vless-proxy` и подключит выбранные сервисы к proxy network.

## Обновление Runtime

Обычный deploy flow:

```bash
cd /opt/remote-vibe-station-runtime
docker compose --env-file .env -f docker-compose.yml -f docker-compose.vless.yml pull
docker compose --env-file .env -f docker-compose.yml -f docker-compose.vless.yml up -d --remove-orphans
```

GitHub Actions workflow `Deploy Runtime` перед pull/up обновляет `.env` на конкретный image tag, сохраняет предыдущий файл как `.env.previous`, затем выполняет те же compose-команды по SSH. Для auto-deploy после `master/main` используется tag `sha-<commit>`, а для ручного workflow можно передать `image_tag` и `runtime_version`.

Необходимые secrets:

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_SSH_KEY`
- `DEPLOY_PORT` optional
- `DEPLOY_RUNTIME_DIR` optional
- `GHCR_USERNAME` optional
- `GHCR_TOKEN` optional

## Проверка После Установки

```bash
cd /opt/remote-vibe-station-runtime
docker compose --env-file .env -f docker-compose.yml -f docker-compose.vless.yml ps
docker compose --env-file .env -f docker-compose.yml -f docker-compose.vless.yml logs --tail=100 backend bot miniapp opencode cliproxy proxy
```

Ожидаемые URLs:

```text
https://<domain>/miniapp
https://<opencode-domain>
```

## Обслуживание

Installer создаёт `runtime-maintenance.sh` и systemd timer `remote-vibe-station-maintenance.timer`.

Cleanup удаляет:

- unused images older than configured window;
- stopped containers;
- unused networks;
- Docker build cache.

Cleanup не удаляет Docker volumes.

## Удаление

Остановить runtime без удаления данных:

```bash
cd /opt/remote-vibe-station-runtime
docker compose --env-file .env -f docker-compose.yml -f docker-compose.vless.yml stop
```

Полное удаление контейнеров без удаления named volumes:

```bash
cd /opt/remote-vibe-station-runtime
docker compose --env-file .env -f docker-compose.yml -f docker-compose.vless.yml down
```

Named volumes удаляйте только если точно больше не нужны данные runtime.
