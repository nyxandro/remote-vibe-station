## Telegram Mini App: Providers

### Что добавлено

- В Mini App добавлена отдельная вкладка `Providers` (до `Settings`).
- В верхней части вкладки показывается текущий выбранный режим OpenCode:
  - `provider`
  - `model`
  - `thinking`
  - `agent`
- Ниже отображается список провайдеров и их статус подключения (`connected` / `not connected`).
- Реализованы сценарии подключения:
  - OAuth (с шагами authorize/callback)
  - API key
- Реализовано отключение провайдера (`disconnect`).

### Backend API (Mini App)

Все маршруты находятся в `TelegramProviderController` и защищены `AppAuthGuard`.

- `GET /api/telegram/providers`
  - Возвращает сводку по провайдерам, включая доступные методы auth и текущий выбранный режим.
- `POST /api/telegram/providers/oauth/authorize`
  - Стартует OAuth flow для указанного провайдера и метода.
- `POST /api/telegram/providers/oauth/callback`
  - Завершает OAuth flow (авто-режим или ручной code).
- `POST /api/telegram/providers/api-key`
  - Сохраняет API key для провайдера.
- `POST /api/telegram/providers/disconnect`
  - Удаляет авторизацию провайдера.

### Валидация и fail-fast

- Для всех операций требуется валидный admin context (`x-admin-id` через guard).
- В OAuth authorize валидируется `methodIndex` как целое число в допустимом диапазоне.
- Для POST-роутов используется явный `200 OK`.

### Основные модули

- Backend:
  - `services/backend/src/open-code/opencode-provider-auth.client.ts`
  - `services/backend/src/telegram/telegram-provider.controller.ts`
- Mini App:
  - `services/miniapp/src/components/ProvidersTab.tsx`
  - `services/miniapp/src/hooks/use-provider-auth.ts`
  - `services/miniapp/src/providers-tab.css`

### Проверка после изменений

1. Открыть Mini App и перейти во вкладку `Providers`.
2. Убедиться, что показывается текущий режим (`provider/model/thinking/agent`).
3. Подключить провайдера через OAuth и убедиться, что статус стал `connected`.
4. Подключить провайдера через API key и проверить изменение статуса.
5. Нажать `Disconnect` и убедиться, что статус снова `not connected`.

### Ошибки провайдера и retry-подсказки

- Ошибки OpenCode HTTP (включая `429`) теперь нормализуются в user-facing сообщение.
- Если OpenCode/провайдер возвращает `retryAfterSec`/`retry_after` или HTTP-header `Retry-After`,
  в ответ добавляется подсказка формата: `Повтор через N сек.`.
- Это сообщение проходит через backend в Telegram без потери контекста,
  поэтому админ видит не только факт ошибки, но и ориентир по времени повторной попытки.
