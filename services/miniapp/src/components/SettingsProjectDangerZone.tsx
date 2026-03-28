/**
 * @fileoverview Destructive project deletion controls extracted from Settings tab.
 *
 * Exports:
 * - SettingsProjectDangerZone - Renders delete action, guard copy, and confirmation modal for the active project.
 */

import { useState } from "react";

import { DangerConfirmModal } from "./DangerConfirmModal";

type Props = {
  activeProjectId: string | null;
  onDeleteActiveProject: () => Promise<void> | void;
};

export const SettingsProjectDangerZone = (props: Props) => {
  const [isConfirmOpen, setIsConfirmOpen] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  if (!props.activeProjectId) {
    return <div className="placeholder">Select a project to manage deletion.</div>;
  }

  return (
    <>
      <button className="btn ghost" disabled={isDeleting} onClick={() => setIsConfirmOpen(true)} type="button">
        Delete selected local project
      </button>

      <div className="project-create-note">
        If the project is a git repository with uncommitted changes, deletion is blocked.
      </div>

      {isConfirmOpen ? (
        <DangerConfirmModal
          title="Удалить локальный проект?"
          description="Папка проекта будет удалена с текущего сервера. Если внутри есть незакоммиченные git-изменения, backend остановит операцию."
          subjectLabel="Выбранный проект"
          subjectTitle={props.activeProjectId}
          cancelLabel="Оставить проект"
          confirmLabel="Удалить проект"
          confirmBusyLabel="Удаляем проект..."
          isBusy={isDeleting}
          onClose={() => setIsConfirmOpen(false)}
          onConfirm={async () => {
            /* Keep the modal responsive while the backend checks git safety and removes the folder. */
            setIsDeleting(true);
            try {
              await props.onDeleteActiveProject();
              setIsConfirmOpen(false);
            } finally {
              setIsDeleting(false);
            }
          }}
        />
      ) : null}
    </>
  );
};
