/**
 * @fileoverview Fullscreen blocking overlay while Mini App backend is unavailable.
 *
 * Exports:
 * - MiniAppBlockingOverlayProps - Input contract for blocking message/actions.
 * - MiniAppBlockingOverlay - Renders busy/error overlay and optional action button.
 */

export type MiniAppBlockingOverlayProps = {
  isChecking: boolean;
  blockReason: string | null;
  onRetry: () => void;
  titleOverride?: string;
  actionLabel?: string | null;
};

export const MiniAppBlockingOverlay = ({
  isChecking,
  blockReason,
  onRetry,
  titleOverride,
  actionLabel
}: MiniAppBlockingOverlayProps) => {
  const title = titleOverride ?? (isChecking ? "Подключаем Mini App..." : "Mini App временно недоступен");
  const message = isChecking
    ? "Проверяем доступность backend и каналов Telegram/OpenCode."
    : blockReason ?? "Не удалось проверить backend";
  const nextActionLabel = actionLabel === undefined ? "Повторить сейчас" : actionLabel;

  return (
    <div className="miniapp-blocking-overlay" role="alert" aria-live="assertive" aria-busy={isChecking}>
      <div className="miniapp-blocking-card">
        <h2 className="miniapp-blocking-title">{title}</h2>
        <p className="miniapp-blocking-text">{message}</p>
        {nextActionLabel ? (
          <button
            type="button"
            className="btn primary miniapp-blocking-retry"
            onClick={onRetry}
            disabled={isChecking}
          >
            {nextActionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
};
