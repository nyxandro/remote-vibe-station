/**
 * @fileoverview CLIProxy account management section for the Providers tab.
 *
 * Exports:
 * - CliproxyAccountsSection - Renders compact account accordions, provider reconnect cards, and OAuth completion controls.
 */

import { useEffect, useState } from "react";

import { CliproxyAccountState, CliproxyOAuthStartPayload } from "../types";
import { CliproxyAccountAccordion } from "./CliproxyAccountAccordion";
import { CliproxyAuthModal } from "./CliproxyAuthModal";
import { DangerConfirmModal } from "./DangerConfirmModal";

type Props = {
  accounts: CliproxyAccountState | null;
  oauthStart: CliproxyOAuthStartPayload | null;
  isLoading: boolean;
  isSubmitting: boolean;
  onReload?: () => void;
  onStartAuth: (provider: CliproxyAccountState["providers"][number]["id"]) => void;
  onCloseAuthModal: () => void;
  onCompleteAuth: (input: {
    provider: CliproxyAccountState["providers"][number]["id"];
    callbackUrl?: string;
    code?: string;
    state?: string;
    error?: string;
  }) => void;
  onTestAccount: (accountId: string) => void;
  onActivateAccount: (accountId: string) => void;
  onDeleteAccount: (accountId: string) => Promise<void> | void;
};

export const CliproxyAccountsSection = (props: Props) => {
  const [callbackUrlDraft, setCallbackUrlDraft] = useState<string>("");
  const [codeDraft, setCodeDraft] = useState<string>("");
  const [stateDraft, setStateDraft] = useState<string>("");
  const [expandedAccountId, setExpandedAccountId] = useState<string | null>(null);
  const [pendingDeleteAccountId, setPendingDeleteAccountId] = useState<string | null>(null);

  useEffect(() => {
    /* Starting a new OAuth flow must drop stale callback fragments from the previous provider attempt. */
    setCallbackUrlDraft("");
    setCodeDraft("");
    setStateDraft(props.oauthStart?.state ?? "");
  }, [props.oauthStart]);

  useEffect(() => {
    /* Remove expansion state when the refreshed account list no longer contains the selected record. */
    if (!expandedAccountId) {
      return;
    }

    const accountStillExists = props.accounts?.accounts.some((account) => account.id === expandedAccountId) ?? false;
    if (!accountStillExists) {
      setExpandedAccountId(null);
    }
  }, [props.accounts, expandedAccountId]);

  useEffect(() => {
    /* Deletion modal should close itself when the selected account disappears after a successful refresh. */
    if (!pendingDeleteAccountId) {
      return;
    }

    const accountStillExists =
      props.accounts?.accounts.some((account) => account.id === pendingDeleteAccountId) ?? false;
    if (!accountStillExists) {
      setPendingDeleteAccountId(null);
    }
  }, [props.accounts, pendingDeleteAccountId]);

  const selectedProvider = props.oauthStart?.provider;
  const oauthProviderLabel =
    props.accounts?.providers.find((provider) => provider.id === selectedProvider)?.label ?? selectedProvider ?? "CLIProxy";
  const pendingDeleteAccount =
    props.accounts?.accounts.find((account) => account.id === pendingDeleteAccountId) ?? null;

  const completeActiveAuth = () => {
    /* Submit only the current provider step so a stale local draft never leaks into a different provider flow. */
    if (!selectedProvider) {
      return;
    }

    props.onCompleteAuth({
      provider: selectedProvider,
      callbackUrl: callbackUrlDraft.trim() || undefined,
      code: codeDraft.trim() || undefined,
      state: stateDraft.trim() || undefined
    });
  };

  return (
    <div className="providers-auth-card">
      {/* CLIProxy onboarding and account steering stay together so operators manage one pool in one place. */}
      <div className="settings-header-row">
        <strong>CLIProxy accounts</strong>
      </div>

      <div className="project-create-note">
        Карточки аккаунтов по умолчанию свернуты: сверху остаются провайдер, почта, статус и основной лимит.
      </div>
      <div className="project-create-note">
        Откройте нужный аккаунт, чтобы увидеть диагностику, квоту, тест, активацию и удаление auth file.
      </div>

      {props.isLoading && !props.accounts ? (
        <div className="project-create-note">Загружаем состояние CLIProxy аккаунтов...</div>
      ) : null}

      {!props.accounts?.usageTrackingEnabled ? (
        <div className="project-create-note">
          CLIProxy: наблюдаемая статистика usage выключена, поэтому активность по аккаунтам пока не собирается.
        </div>
      ) : null}

      <div className="providers-list">
        {props.accounts?.accounts.map((account) => (
          <CliproxyAccountAccordion
            key={`cliproxy-account:${account.id}`}
            account={account}
            isExpanded={expandedAccountId === account.id}
            isSubmitting={props.isSubmitting}
            onToggle={() => setExpandedAccountId((prev) => (prev === account.id ? null : account.id))}
            onTestAccount={props.onTestAccount}
            onActivateAccount={props.onActivateAccount}
            onRequestDelete={setPendingDeleteAccountId}
          />
        ))}

        {!props.accounts || props.accounts.accounts.length === 0 ? (
          <div className="providers-empty">Пока нет подключенных CLIProxy аккаунтов.</div>
        ) : null}
      </div>

      <div className="providers-list">
        {(props.accounts?.providers ?? []).map((provider) => (
          <div key={`cliproxy-provider:${provider.id}`} className="providers-item-card">
            {/* Provider cards stay separate because login flows are provider-scoped, not tied to one account. */}
            <div className="providers-item-head">
              <span className="providers-item-name">{provider.label}</span>
              <span className={`providers-badge ${provider.connected ? "connected" : "disconnected"}`}>
                {provider.connected ? "Connected" : "Disconnected"}
              </span>
            </div>
            <button
              className="btn outline"
              type="button"
              disabled={props.isSubmitting}
              onClick={() => props.onStartAuth(provider.id)}
            >
              Подключить / обновить
            </button>
          </div>
        ))}
      </div>

      <CliproxyAuthModal
        oauthStart={props.oauthStart}
        providerLabel={oauthProviderLabel}
        isSubmitting={props.isSubmitting}
        callbackUrlDraft={callbackUrlDraft}
        codeDraft={codeDraft}
        stateDraft={stateDraft}
        onCallbackUrlChange={setCallbackUrlDraft}
        onCodeChange={setCodeDraft}
        onStateChange={setStateDraft}
        onClose={props.onCloseAuthModal}
        onSubmit={completeActiveAuth}
      />

      {pendingDeleteAccount ? (
        <DangerConfirmModal
          title="Удалить CLIProxy аккаунт?"
          description="Mini App удалит auth file этого аккаунта из CLIProxy. Если он понадобится снова, авторизацию придется пройти заново."
          subjectLabel="Выбранный аккаунт"
          subjectTitle={pendingDeleteAccount.name}
          subjectMeta={[pendingDeleteAccount.providerLabel, pendingDeleteAccount.status ?? "unknown"]}
          cancelLabel="Оставить аккаунт"
          confirmLabel="Удалить аккаунт"
          confirmBusyLabel="Удаляем аккаунт..."
          isBusy={props.isSubmitting}
          onClose={() => setPendingDeleteAccountId(null)}
          onConfirm={async () => {
            /* Close only after the current CLIProxy mutation finishes so repeated taps cannot double-submit deletion. */
            await props.onDeleteAccount(pendingDeleteAccount.id);
            setPendingDeleteAccountId(null);
          }}
        />
      ) : null}
    </div>
  );
};
