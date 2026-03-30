/**
 * @fileoverview Shared add-project modal with create-folder and git-clone modes.
 *
 * Exports:
 * - ProjectAddModal - Opens from Projects tab and keeps both project creation flows inside one reusable modal shell.
 */

import { useEffect, useId, useState } from "react";
import { FolderPlus, GitBranch } from "lucide-react";

import { ActionModal } from "./ActionModal";

type ProjectAddMode = "create" | "clone";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onCreateProjectFolder: (name: string) => Promise<void> | void;
  onCloneRepository: (repositoryUrl: string, folderName?: string) => Promise<void> | void;
};

const CREATE_MODE: ProjectAddMode = "create";
const CLONE_MODE: ProjectAddMode = "clone";

export const ProjectAddModal = (props: Props) => {
  const tabPanelId = useId();
  const [mode, setMode] = useState<ProjectAddMode>(CREATE_MODE);
  const [folderName, setFolderName] = useState<string>("");
  const [repoUrl, setRepoUrl] = useState<string>("");
  const [cloneFolderName, setCloneFolderName] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    /* Closing the modal should reset stale drafts so every reopen starts from one clean creation flow. */
    if (props.isOpen) {
      return;
    }

    setMode(CREATE_MODE);
    setFolderName("");
    setRepoUrl("");
    setCloneFolderName("");
    setIsSubmitting(false);
    setSubmitError(null);
  }, [props.isOpen]);

  const switchMode = (nextMode: ProjectAddMode): void => {
    /* Mode switches must not race with an in-flight submit and should clear stale validation copy from the previous mode. */
    if (isSubmitting) {
      return;
    }

    setMode(nextMode);
    setSubmitError(null);
  };

  const submit = async (): Promise<void> => {
    /* Each mode validates only its own required fields and keeps the error inside the modal instead of failing silently. */
    setSubmitError(null);

    try {
      setIsSubmitting(true);
      if (mode === CREATE_MODE) {
        const normalizedFolderName = folderName.trim();
        if (!normalizedFolderName) {
          throw new Error("APP_PROJECT_NAME_REQUIRED: Project folder name is required. Enter a folder name and try again.");
        }

        await Promise.resolve(props.onCreateProjectFolder(normalizedFolderName));
      } else {
        const normalizedRepoUrl = repoUrl.trim();
        if (!normalizedRepoUrl) {
          throw new Error("APP_REPOSITORY_URL_REQUIRED: Repository URL is required. Paste a git URL and try again.");
        }

        await Promise.resolve(props.onCloneRepository(normalizedRepoUrl, cloneFolderName.trim() || undefined));
      }

      props.onClose();
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "APP_PROJECT_MODAL_SUBMIT_FAILED: Project action failed. Retry the request."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ActionModal
      isOpen={props.isOpen}
      title="Add project"
      description="Create an empty project folder or clone an existing git repository into the shared projects root."
      tone="primary"
      closeLabel="Close add project"
      isBusy={isSubmitting}
      onClose={props.onClose}
      footer={
        <button
          className="btn primary"
          disabled={isSubmitting || (mode === CREATE_MODE ? !folderName.trim() : !repoUrl.trim())}
          onClick={() => void submit()}
          type="button"
        >
          {isSubmitting ? "Working..." : mode === CREATE_MODE ? "Create project folder" : "Clone repository now"}
        </button>
      }
    >
      <div className="project-add-modal-mode-row" role="tablist" aria-label="Project add mode">
        <button
          className={mode === CREATE_MODE ? "project-add-modal-mode-btn project-add-modal-mode-btn-active" : "project-add-modal-mode-btn"}
          role="tab"
          aria-selected={mode === CREATE_MODE}
          aria-controls={tabPanelId}
          disabled={isSubmitting}
          onClick={() => switchMode(CREATE_MODE)}
          type="button"
        >
          <FolderPlus size={16} aria-hidden="true" />
          <span>Local</span>
        </button>
        <button
          className={mode === CLONE_MODE ? "project-add-modal-mode-btn project-add-modal-mode-btn-active" : "project-add-modal-mode-btn"}
          role="tab"
          aria-selected={mode === CLONE_MODE}
          aria-controls={tabPanelId}
          disabled={isSubmitting}
          onClick={() => switchMode(CLONE_MODE)}
          type="button"
        >
          <GitBranch size={16} aria-hidden="true" />
          <span>Git</span>
        </button>
      </div>

      <div className="project-add-modal-form" id={tabPanelId} role="tabpanel">
        {mode === CREATE_MODE ? (
          <>
            <input
              aria-label="Project name"
              className="input"
              placeholder="project-name"
              value={folderName}
              onChange={(event) => setFolderName(event.target.value)}
            />
            <div className="project-create-note">A new folder will be created inside the shared projects root.</div>
          </>
        ) : (
          <>
            <input
              aria-label="Repository URL"
              className="input"
              placeholder="https://github.com/org/repo.git"
              value={repoUrl}
              onChange={(event) => setRepoUrl(event.target.value)}
            />
            <input
              aria-label="Clone folder name"
              className="input"
              placeholder="folder name (optional)"
              value={cloneFolderName}
              onChange={(event) => setCloneFolderName(event.target.value)}
            />
            <div className="project-create-note">Uses git credentials configured in backend runtime/container.</div>
          </>
        )}

        {submitError ? <div className="alert">{submitError}</div> : null}
      </div>
    </ActionModal>
  );
};
