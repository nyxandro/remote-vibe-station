# Runtime Install (Image-Only)

Этот сценарий ставит и запускает стек без исходников проекта на сервере.

## Что делает скрипт

- Устанавливает системные зависимости (`curl`, `ufw`, `fail2ban`, `openssl`, `jq`, `git`, `gh`)
- Устанавливает Docker (если отсутствует)
- Генерирует runtime-директорию с файлами:
  - `docker-compose.yml`
  - `.env`
  - `infra/traefik/*`
  - `infra/cliproxy/config.yaml`
- Генерирует все секреты автоматически:
  - `OPENCODE_SERVER_PASSWORD`
  - `CLIPROXY_MANAGEMENT_PASSWORD`
  - `CLIPROXY_API_KEY`
- Выполняет preflight перед запуском:
  - DNS для `--domain` и `code.<domain>` резолвится
  - домены указывают на текущий сервер
  - порты `80/443` свободны
  - сгенерированный `docker-compose.yml` валиден
- Настраивает UFW:
  - deny incoming / allow outgoing
  - allow 22, 80, 443
  - limit 22 (anti-bruteforce)
- Настраивает `fail2ban` для `sshd`
- Опционально авторизует GitHub CLI (`gh`) по токену
- Поднимает стек через `docker compose`

## Быстрый запуск

```bash
sudo ./scripts/install-runtime.sh \
  --bot-token "<TELEGRAM_BOT_TOKEN>" \
  --admin-id "<TELEGRAM_ADMIN_ID>" \
  --domain "example.com" \
  --tls-email "ops@example.com" \
  --github-token "<GITHUB_TOKEN_OPTIONAL>"
```

Для удаленной dev-среды без собственного домена можно передать `--domain auto`.
Скрипт определит публичный IPv4 сервера и подставит `${IP}.sslip.io` + `code.${IP}.sslip.io`.

Если preflight нужно временно пропустить (не рекомендуется), добавьте `--skip-preflight`.

Минимально обязательные параметры:

- `--bot-token`
- `--admin-id`
- `--domain`
- `--tls-email`

## Dry run

Проверка генерации файлов без установки пакетов/файрвола/запуска Docker:

```bash
./scripts/install-runtime.sh \
  --dry-run \
  --install-dir /tmp/rvs-runtime \
  --bot-token "123:token" \
  --admin-id "1" \
  --domain "example.com" \
  --tls-email "ops@example.com"
```

## Важные замечания по безопасности

- Скрипт не хранит исходники проекта на сервере: только runtime-конфиг и Docker volumes.
- Образы backend/miniapp/bot/opencode должны быть заранее опубликованы в registry.
- По умолчанию используются `ghcr.io/nyxandro/...:latest`; их можно переопределить флагами `--*-image`.
- Если OpenCode/CLIProxy management интерфейсы не нужны публично, не публикуйте дополнительные порты в compose.
