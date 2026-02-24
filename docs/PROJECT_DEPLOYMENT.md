# Project Deployment via Mini App

Документ описывает базовый runtime-деплой проектов на поддоменах без внешних SaaS.

## Что реализовано

- Для каждого проекта добавлен deploy runtime с API:
  - `GET /api/projects/:id/deploy/settings`
  - `POST /api/projects/:id/deploy/settings`
  - `POST /api/projects/:id/deploy/start`
  - `POST /api/projects/:id/deploy/stop`
- В Mini App (Projects tab) добавлены кнопки `Deploy` / `Stop deploy` прямо в карточке проекта.
- В Settings -> `Project settings` добавлена форма runtime-настроек:
  - `mode` (`docker` / `static`),
  - `serviceName` и `internalPort` для docker,
  - `staticRoot` для static,
  - quick-preset кнопки `Use <service>` по списку сервисов compose,
  - кнопка `Save deploy settings`.

## Runtime modes

### docker (по умолчанию)

- Бекенд читает compose-конфиг проекта через `docker compose config --format json`.
- Если `serviceName` не задан:
  - при одном сервисе выбирается он,
  - при нескольких сервисах выбрасывается ошибка с требованием задать `serviceName`.
- Если `internalPort` не задан, порт пытается определиться из `expose`/`ports`.
- Если `internalPort` задан явно, используется это значение.
- В Mini App `internalPort` валидируется на диапазон `1..65535` до отправки в API.
- Для избежания конфликтов host-портов генерируется runtime override:
  - для всех сервисов `ports: []`,
  - для целевого сервиса добавляются Traefik labels и сеть `public`.

### static

- Генерируется runtime compose с `nginx:alpine`.
- Контент отдается из `staticRoot` (обязательное явное поле, без fallback по умолчанию).

## Домен проекта

- URL проекта формируется как `https://<slug>.<PUBLIC_DOMAIN>`.
- Slug проекта используется как стабильный идентификатор маршрута.

## Хранение настроек

- Настройки runtime сохраняются в `data/project-runtime.settings.json`.
- Сгенерированные runtime override файлы сохраняются в `data/runtime-overrides/`.

## Ограничения и ожидания

- Для `docker` mode проект должен иметь compose-файл в корне (`docker-compose.yml|yaml|compose.yml|yaml`).
- Для `static` mode `staticRoot` обязателен, должен существовать и быть директорией.
- Traefik должен быть доступен в сети `public`.
