# Kanban Runner Reliability TODO

## Контекст

Наблюдаемые симптомы в длинных kanban-сессиях:

- уведомление `взял в работу` иногда приходит раньше финального ответа по прошлой задаче;
- после длинной или восстановленной сессии SSE/runtime-сообщения начинают смешиваться или пропадать;
- перед переходом к новой сессии у финального сообщения иногда отсутствует технический footer;
- handoff между задачами завязан на таймер, а не на фактическую финализацию и доставку ответа.

Смежный риск вне kanban:

- обычная Telegram queue для длинных prompt-сессий тоже потенциально проходит через те же `allowEmptyResponse`/runtime-only ветки;
- значит часть исправлений должна покрывать не только runner, но и общий long-session path для queued prompts.

## Подтвержденные причины в текущей архитектуре

- `KanbanRunnerService` живет мимо стандартного prompt-flow и не публикует нормальный `opencode.turn.started` на каждый runner turn.
- runner публикует `kanban.runner.started` сразу перед `sendPromptWithSettle()`, то есть до финализации предыдущего ответа.
- footer добавляется только через `opencode.message -> enqueueAssistantReply()`, а runner и recover-path могут завершаться без `opencode.message`.
- `waitForSessionToSettle()`/`emptyResponse` ветки считают turn успешным, но не гарантируют публикацию финального ответа с метаданными.
- handoff на следующую задачу сейчас запускается по таймеру, а не по подтвержденной доставке финального ответа в Telegram.

## Цель переработки

Сделать runner-поток семантически эквивалентным обычному prompt-flow:

- каждый новый runner turn явно открывает runtime turn;
- каждый успешный runner turn публикует финальный assistant reply через единый путь с footer;
- next-task handoff не стартует, пока предыдущий финал не зафиксирован на backend и не готов к доставке;
- длинные/reused sessions не теряют SSE-события после первого `idle`.

Параллельная цель для обычной очереди сообщений:

- queued prompt flow на длинных сессиях тоже не должен завершаться silent-success без финального `opencode.message` и footer.

## Этап 1. Унифицировать lifecycle runner turn

- [x] Выделить общий publisher для финального assistant reply, чтобы им пользовались и `PromptService`, и `KanbanRunnerService`.
- [x] На каждый runner turn публиковать `opencode.turn.started` до отправки prompt, даже если используется старая session.
- [x] Добавить тест, что long-lived runner session после `idle` заново открывает runtime gate и Telegram снова принимает SSE.
- [x] Добавить тест, что runner больше не зависит от implicit-open поведения `TelegramRuntimeTurnState`.

### Критерий готовности

- повторный запуск в той же runner session не теряет tool/question/text runtime events;
- runtime bridge получает явный `opencode.turn.started` на каждый runner run.

## Этап 2. Гарантировать финальный reply и footer для runner/recover-path

- [x] На successful runner execution публиковать `opencode.message` через общий publisher, а не только `kanban.runner.finished`.
- [x] На transport-settle/empty-response пути сохранять fallback metadata для footer: model/provider/agent/tokens минимум в деградированном виде.
- [x] Проверить и исправить ветки, где recover-path завершает turn без enqueue финального Telegram reply.
- [x] Добавить тест, что footer присутствует и для runner completion, и для settle-after-fetch-failure.
- [x] Проверить тот же recover-path в обычной Telegram prompt queue и закрыть те же silent-success дыры для non-kanban flow.

### Критерий готовности

- любой успешный runner turn дает один финальный Telegram reply с footer;
- отсутствие синхронного HTTP body больше не приводит к silent-success без footer.

## Этап 3. Развязать handoff от слепого таймера

- [x] Ввести явный backend-level handoff barrier между `previous final assistant reply` и `next kanban.runner.started`.
- [x] Привязать barrier к финализации/delivery state outbox, а не только к task status `done/blocked`.
- [x] Перестать считать `RUNNER_NEXT_TASK_DELAY_MS` главным механизмом сериализации; оставить его только как safety fallback или убрать.
- [x] Добавить тест, что next task не стартует, пока финальный ответ прошлой задачи не прошел через final-reply barrier.

### Детальный дизайн этапа 3

Наблюдения по текущему коду:

- `TelegramOutboxStore.report()` уже знает точный момент delivery confirmation (`status=delivered`, `deliveredAt`) в `services/backend/src/telegram/outbox/telegram-outbox.store.ts`.
- `KanbanRunnerService` сейчас принимает решение о handoff через `scheduleProjectRunAfterHandoff()` и `RUNNER_NEXT_TASK_DELAY_MS` в `services/backend/src/kanban/kanban-runner.service.ts`.
- В текущей схеме нет связующего идентификатора между `opencode.message`/final Telegram reply и последующим `runner-finished -> claim-next`.

Предлагаемая архитектура barrier:

1. Ввести отдельный persistent store ожидания handoff, например `kanban-runner-handoff.store.ts`.
2. Когда runner публикует финальный `opencode.message` для task `T`, backend должен зарегистрировать `pending handoff`:
   - `projectSlug`
   - `taskId`
   - `sessionId`
   - `runnerReason`
   - `awaitingOutboxItemIds[]` или `awaitingProgressKeys[]`
   - `createdAt/expireAt`
3. На уровне outbox нужен способ пометить, какие именно item ids относятся к финальному reply прошлой задачи.
4. После `TelegramOutboxStore.report(ok=true)` backend должен публиковать отдельное событие вроде `telegram.outbox.delivered` с `itemId`, `progressKey`, `deliveredAt`.
5. Handoff barrier слушает это событие и снимает ожидание только когда доставлены все финальные chunks нужного reply.
6. Только после этого публикуется внутренний release-сигнал, который разрешает `KanbanRunnerService` запускать следующий claim.

Минимально безопасный вариант для первой итерации:

- не пытаться связывать handoff со всеми runtime/commentary сообщениями;
- ждать delivery только для final assistant reply bubble, то есть для item(s), созданных `enqueueAssistantReply()`;
- если final reply разбился на несколько outbox items, barrier должен ждать доставки всех chunks одного logical reply.

Как связать logical reply с outbox без хрупкого парсинга текста:

- добавить в outbox item явный `handoffKey` или `deliveryGroupId`;
- `enqueueAssistantReply()` назначает один `deliveryGroupId` всем chunks финального ответа;
- runner при публикации финального reply получает этот `deliveryGroupId` назад или регистрирует его в handoff-store;
- `report()` публикует событие доставки с этим же `deliveryGroupId`.

Почему `progressKey` alone недостаточен:

- один progressKey описывает replace-stream lifecycle, но финальный ответ может материализоваться несколькими item/chunk;
- кроме того, same-session reused progress keys не должны случайно открыть handoff чужого turn.

Предлагаемая последовательность реализации этапа 3:

1. Расширить outbox types item-level полем `deliveryGroupId` для финальных assistant replies.
2. Научить `TelegramOutboxService.enqueueAssistantReply()` назначать общий `deliveryGroupId` всем final chunks одного ответа.
3. Добавить publish hook после `TelegramOutboxStore.report(ok=true)` для `telegram.outbox.delivered`.
4. Ввести `KanbanRunnerHandoffService`, который:
   - регистрирует pending handoff после финального runner reply;
   - слушает `telegram.outbox.delivered`;
   - отслеживает completion всех items в `deliveryGroupId`;
   - по completion вызывает release callback/event.
5. Перевести `KanbanRunnerService` с таймера на ожидание release event.
6. Оставить `RUNNER_NEXT_TASK_DELAY_MS` только как watchdog fallback на переходный период, затем удалить, если тесты и эксплуатация покажут стабильность.

Тест-план этапа 3:

- unit: handoff не отпускается после `kanban.runner.finished`, пока нет `telegram.outbox.delivered` по final group;
- unit: handoff отпускается после доставки всех chunks финального reply;
- unit: retry/backoff не запускает следующий claim преждевременно;
- unit: commentary/runtime items не снимают barrier;
- integration-ish: `final reply -> delivered -> next kanban.runner.started` сохраняет порядок в event log.

### Критерий готовности

- Telegram не показывает `взял в работу` раньше финального ответа прошлой задачи даже при retry/backoff;
- runner handoff зависит от подтвержденного финала, а не от времени ожидания.

## Этап 4. Усилить устойчивость длинных сессий

- [ ] Проверить, не теряются ли buffered text segments при `session.idle`/`session.status idle` и `clearSessionRuntimeState()`.
- [ ] При необходимости добавить explicit flush перед закрытием runtime state, если финальный authoritative reply еще не опубликован.
- [ ] Проверить дедуп/replay guards для reused session на границе нескольких turn внутри одной session.
- [ ] Добавить тесты на sequence: `runner finished -> idle -> same session reopened -> new deltas/questions/tools`.
- [ ] Отдельно проверить long-session поведение обычной queued prompt pipeline: `dispatchPromptParts(allowEmptyResponse=true) -> runtime-only finalization -> Telegram queue/outbox`.

### Критерий готовности

- длинная reused session не смешивает старые и новые runtime fragments;
- хвост ответа не пропадает при закрытии turn.

## Этап 5. Диагностика и эксплуатация

- [x] Добавить структурированные breadcrumbs для runner handoff: turn started, final reply published, outbox final reply enqueued, outbox final reply delivered, next task released.
- [x] Добавить такие же breadcrumbs для обычной queued prompt pipeline на recover-path, чтобы long-session глюки вне kanban были диагностируемы так же быстро.
- [x] Подготовить минимальный сценарий регрессии для воспроизведения long-session handoff в тестах.
- [x] Прогнать полный backend test suite и точечные Telegram/kanban tests.

## Порядок реализации

1. Этап 1
2. Этап 2
3. Этап 3
4. Этап 4
5. Этап 5

## Что делаю прямо сейчас

- Этапы 1-3 и диагностические breadcrumbs уже внедрены; дальше остается дожать финальные регрессионные сценарии long-session handoff и эксплуатационную проверку.
