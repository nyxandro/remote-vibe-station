/**
 * @fileoverview Fullscreen blocking overlay while Mini App backend is unavailable.
 *
 * Exports:
 * - MiniAppBlockingOverlayProps (L12) - Input contract for blocking message/actions.
 * - MiniAppBlockingOverlay (L17) - Renders busy/error overlay and retry button.
 */

export type MiniAppBlockingOverlayProps = {
  isChecking: boolean;
  blockReason: string | null;
  onRetry: () => void;
};

export const MiniAppBlockingOverlay = ({
  isChecking,
  blockReason,
  onRetry
}: MiniAppBlockingOverlayProps) => {
  const title = isChecking ? "Подключаем Mini App..." : "Mini App временно недоступен";
  const message = isChecking
    ? "Проверяем доступность backend и каналов Telegram/OpenCode."
    : blockReason ?? "Не удалось проверить backend";

  return (
    <div className="miniapp-blocking-overlay" role="alert" aria-live="assertive" aria-busy={isChecking}>
      <div className="miniapp-blocking-card">
        <h2 className="miniapp-blocking-title">{title}</h2>
        <p className="miniapp-blocking-text">{message}</p>
        <button
          type="button"
          className="btn primary miniapp-blocking-retry"
          onClick={onRetry}
          disabled={isChecking}
        >
          Повторить сейчас
        </button>
      </div>
    </div>
  );
};
