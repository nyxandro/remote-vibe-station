/**
 * @fileoverview Telegram mode control menu (model/thinking/agent selectors).
 *
 * Exports:
 * - MODE_BUTTON_TEXT (L17) - Persistent reply-keyboard default button label.
 * - MODE_BUTTON_PREFIX (L18) - Prefix for matching dynamic mode button labels.
 * - buildModeButtonText (L20) - Renders `Режим | <project>` button label.
 * - modeReplyKeyboard (L28) - Keyboard with mode entrypoint button.
 * - registerModeControl (L94) - Registers command/text/callback handlers.
 */

import { Markup, Telegraf } from "telegraf";

import { BotConfig } from "./config";
import { encodeModeCallback, parseModeCallback } from "./mode-callback";

export const MODE_BUTTON_TEXT = "⚙️ Режим";
export const MODE_BUTTON_PREFIX = "⚙️";

export const buildModeButtonText = (activeProjectSlug: string | null | undefined): string => {
  /* Keep default short label unless current active project is known. */
  const normalized = String(activeProjectSlug ?? "").trim();
  return normalized.length > 0 ? `${MODE_BUTTON_TEXT} | ${normalized}` : MODE_BUTTON_TEXT;
};

export const modeReplyKeyboard = (buttonText?: string) =>
  Markup.keyboard([[buttonText ?? MODE_BUTTON_TEXT]]).resize();

type TelegramSettingsSnapshot = {
  selected: {
    model: { providerID: string; modelID: string };
    thinking: string | null;
    agent: string | null;
  };
  providers: Array<{ id: string; name: string; connected: boolean }>;
  models: Array<{ id: string; name: string; variants: string[] }>;
  agents: Array<{ name: string; description?: string }>;
  thinkingOptions: string[];
};

type RegisterModeControlInput = {
  bot: Telegraf;
  config: BotConfig;
  isAdmin: (id: number | undefined) => boolean;
};

const PAGE_SIZE = 8;

const pageSlice = <T>(items: T[], page: number): T[] => {
  const start = page * PAGE_SIZE;
  return items.slice(start, start + PAGE_SIZE);
};

const statusText = (settings: TelegramSettingsSnapshot): string => {
  /* Render one compact status block for the menu message. */
  const selectedModel = `${settings.selected.model.providerID}/${settings.selected.model.modelID}`;
  const selectedThinking = settings.selected.thinking ?? "default";
  const selectedAgent = settings.selected.agent ?? "build (default)";
  return [
    "⚙️ Текущий режим",
    `Model: ${selectedModel}`,
    `Thinking: ${selectedThinking}`,
    `Agent: ${selectedAgent}`
  ].join("\n");
};

const modeMainKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("Модель", encodeModeCallback("providers", ["0"]))],
    [Markup.button.callback("Степень мышления", encodeModeCallback("thinking"))],
    [Markup.button.callback("Агент", encodeModeCallback("agents", ["0"]))]
  ]);

const parsePositivePage = (value: string | undefined): number => {
  const parsed = Number(value ?? "0");
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
};

const encodeProvider = (providerID: string): string => encodeURIComponent(providerID);
const decodeProvider = (value: string): string => {
  /* Malformed callback payloads must not crash handler path. */
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const registerModeControl = ({ bot, config, isAdmin }: RegisterModeControlInput): void => {
  const fetchSettings = async (adminId: number): Promise<TelegramSettingsSnapshot> => {
    const response = await fetch(`${config.backendUrl}/api/telegram/settings`, {
      headers: { "x-admin-id": String(adminId) }
    });

    if (!response.ok) {
      throw new Error(`Failed to load settings: ${response.status}`);
    }

    return (await response.json()) as TelegramSettingsSnapshot;
  };

  const fetchModels = async (
    adminId: number,
    providerID: string
  ): Promise<Array<{ id: string; name: string; variants: string[] }>> => {
    const response = await fetch(
      `${config.backendUrl}/api/telegram/settings/models?providerID=${encodeURIComponent(providerID)}`,
      {
        headers: { "x-admin-id": String(adminId) }
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to load models: ${response.status}`);
    }

    const body = (await response.json()) as { models?: Array<{ id: string; name: string; variants: string[] }> };
    return Array.isArray(body.models) ? body.models : [];
  };

  const updateSettings = async (
    adminId: number,
    payload: { providerID?: string; modelID?: string; thinking?: string | null; agent?: string | null }
  ): Promise<TelegramSettingsSnapshot> => {
    const response = await fetch(`${config.backendUrl}/api/telegram/settings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-id": String(adminId)
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || `Failed to update settings: ${response.status}`);
    }

    return (await response.json()) as TelegramSettingsSnapshot;
  };

  const showMain = async (ctx: any): Promise<void> => {
    /* Re-render main settings panel after any update. */
    const settings = await fetchSettings(ctx.from.id);
    const text = statusText(settings);

    if (ctx.updateType === "callback_query") {
      await ctx.editMessageText(text, modeMainKeyboard());
      await ctx.answerCbQuery("Обновлено");
      return;
    }

    await ctx.reply(text, modeMainKeyboard());
  };

  bot.command("mode", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("Access denied");
      return;
    }
    await showMain(ctx);
  });

  bot.hears(/^⚙️/, async (ctx) => {
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("Access denied");
      return;
    }
    await showMain(ctx);
  });

  bot.on("callback_query", async (ctx, next) => {
    /* Handle only mode-prefixed callbacks and leave other callbacks untouched. */
    const data = "data" in ctx.callbackQuery ? String(ctx.callbackQuery.data) : "";
    const parsed = parseModeCallback(data);
    if (!parsed) {
      /* Delegate non-mode callbacks (eg OpenCode question replies) to downstream handlers. */
      if (typeof next === "function") {
        await next();
      }
      return;
    }

    if (!isAdmin(ctx.from?.id)) {
      await ctx.answerCbQuery("Access denied");
      return;
    }

    try {
      if (parsed.action === "main") {
        await showMain(ctx);
        return;
      }

      if (parsed.action === "providers") {
        const page = parsePositivePage(parsed.parts[0]);
        const settings = await fetchSettings(ctx.from.id);
        const slice = pageSlice(settings.providers, page);
        const rows = slice.map((provider, index) => {
          const marker =
            provider.id === settings.selected.model.providerID ? "✅ " : provider.connected ? "🟢 " : "";
          return [
            Markup.button.callback(
              `${marker}${provider.name}`,
              encodeModeCallback("provider", [String(page), String(index)])
            )
          ];
        });

        const nav: any[] = [];
        if (page > 0) {
          nav.push(Markup.button.callback("⬅️", encodeModeCallback("providers", [String(page - 1)])));
        }
        if ((page + 1) * PAGE_SIZE < settings.providers.length) {
          nav.push(Markup.button.callback("➡️", encodeModeCallback("providers", [String(page + 1)])));
        }
        if (nav.length > 0) {
          rows.push(nav);
        }
        rows.push([Markup.button.callback("↩️ Назад", encodeModeCallback("main"))]);

        await ctx.editMessageText("Выбери провайдера", Markup.inlineKeyboard(rows));
        await ctx.answerCbQuery();
        return;
      }

      if (parsed.action === "provider") {
        const settings = await fetchSettings(ctx.from.id);
        const page = parsePositivePage(parsed.parts[0]);
        const index = parsePositivePage(parsed.parts[1]);
        const provider = pageSlice(settings.providers, page)[index];
        if (!provider) {
          await ctx.answerCbQuery("Провайдер не найден");
          return;
        }

        const providerID = provider.id;
        const models = await fetchModels(ctx.from.id, providerID);
        const rows = pageSlice(models, 0).map((model, modelIndex) => [
          Markup.button.callback(
            model.name,
            encodeModeCallback("model", [encodeProvider(providerID), "0", String(modelIndex)])
          )
        ]);

        if (PAGE_SIZE < models.length) {
          rows.push([
            Markup.button.callback("➡️", encodeModeCallback("models", [encodeProvider(providerID), "1"]))
          ]);
        }

        rows.push([Markup.button.callback("↩️ Провайдеры", encodeModeCallback("providers", [String(page)]))]);

        await ctx.editMessageText(`Модели: ${provider.name}`, Markup.inlineKeyboard(rows));
        await ctx.answerCbQuery();
        return;
      }

      if (parsed.action === "models") {
        const providerID = decodeProvider(parsed.parts[0] ?? "");
        const page = parsePositivePage(parsed.parts[1]);
        const models = await fetchModels(ctx.from.id, providerID);
        const slice = pageSlice(models, page);

        const rows = slice.map((model, index) => [
          Markup.button.callback(
            model.name,
            encodeModeCallback("model", [encodeProvider(providerID), String(page), String(index)])
          )
        ]);

        const nav: any[] = [];
        if (page > 0) {
          nav.push(
            Markup.button.callback("⬅️", encodeModeCallback("models", [encodeProvider(providerID), String(page - 1)]))
          );
        }
        if ((page + 1) * PAGE_SIZE < models.length) {
          nav.push(
            Markup.button.callback("➡️", encodeModeCallback("models", [encodeProvider(providerID), String(page + 1)]))
          );
        }
        if (nav.length > 0) {
          rows.push(nav);
        }

        rows.push([Markup.button.callback("↩️ Провайдеры", encodeModeCallback("providers", ["0"]))]);

        await ctx.editMessageText(`Модели (${providerID})`, Markup.inlineKeyboard(rows));
        await ctx.answerCbQuery();
        return;
      }

      if (parsed.action === "model") {
        const providerID = decodeProvider(parsed.parts[0] ?? "");
        const page = parsePositivePage(parsed.parts[1]);
        const index = parsePositivePage(parsed.parts[2]);
        const models = await fetchModels(ctx.from.id, providerID);
        const model = pageSlice(models, page)[index];
        if (!model) {
          await ctx.answerCbQuery("Модель не найдена");
          return;
        }

        await updateSettings(ctx.from.id, { providerID, modelID: model.id });
        await showMain(ctx);
        return;
      }

      if (parsed.action === "thinking") {
        const settings = await fetchSettings(ctx.from.id);
        const rows = [
          [
            Markup.button.callback(
              settings.selected.thinking ? "default" : "✅ default",
              encodeModeCallback("thinkingSet", ["default"])
            )
          ],
          ...settings.thinkingOptions.map((item) => [
            Markup.button.callback(
              settings.selected.thinking === item ? `✅ ${item}` : item,
              encodeModeCallback("thinkingSet", [encodeURIComponent(item)])
            )
          ]),
          [Markup.button.callback("↩️ Назад", encodeModeCallback("main"))]
        ];

        await ctx.editMessageText("Степень мышления", Markup.inlineKeyboard(rows));
        await ctx.answerCbQuery();
        return;
      }

      if (parsed.action === "thinkingSet") {
        const raw = parsed.parts[0] ?? "default";
        const thinking = raw === "default" ? null : decodeURIComponent(raw);
        await updateSettings(ctx.from.id, { thinking });
        await showMain(ctx);
        return;
      }

      if (parsed.action === "agents") {
        const page = parsePositivePage(parsed.parts[0]);
        const settings = await fetchSettings(ctx.from.id);
        const selectableAgents = settings.agents.filter((item) => item.name !== "build");
        const rows = [
          [
            Markup.button.callback(
              settings.selected.agent ? "build (default)" : "✅ build (default)",
              encodeModeCallback("agentSet", [String(page), "default"])
            )
          ],
          ...pageSlice(selectableAgents, page).map((item, index) => [
            Markup.button.callback(
              settings.selected.agent === item.name ? `✅ ${item.name}` : item.name,
              encodeModeCallback("agentSet", [String(page), String(index)])
            )
          ])
        ];

        const nav: any[] = [];
        if (page > 0) {
          nav.push(Markup.button.callback("⬅️", encodeModeCallback("agents", [String(page - 1)])));
        }
        if ((page + 1) * PAGE_SIZE < selectableAgents.length) {
          nav.push(Markup.button.callback("➡️", encodeModeCallback("agents", [String(page + 1)])));
        }
        if (nav.length > 0) {
          rows.push(nav);
        }
        rows.push([Markup.button.callback("↩️ Назад", encodeModeCallback("main"))]);

        await ctx.editMessageText("Выбери агента", Markup.inlineKeyboard(rows));
        await ctx.answerCbQuery();
        return;
      }

      if (parsed.action === "agentSet") {
        const page = parsePositivePage(parsed.parts[0]);
        const value = parsed.parts[1] ?? "default";
        if (value === "default") {
          await updateSettings(ctx.from.id, { agent: null });
          await showMain(ctx);
          return;
        }

        const settings = await fetchSettings(ctx.from.id);
        const selectableAgents = settings.agents.filter((item) => item.name !== "build");
        const agent = pageSlice(selectableAgents, page)[parsePositivePage(value)];
        if (!agent) {
          await ctx.answerCbQuery("Агент не найден");
          return;
        }

        await updateSettings(ctx.from.id, { agent: agent.name });
        await showMain(ctx);
        return;
      }

      await ctx.answerCbQuery();
    } catch (error) {
      await ctx.answerCbQuery("Ошибка настройки", { show_alert: true });
      // eslint-disable-next-line no-console
      console.error("Mode control error", error);
    }
  });
};
