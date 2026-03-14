/**
 * @fileoverview Tests for guarding the kanban tab when no project is selected.
 */

/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";

const { apiGetMock, apiPostMock, apiDownloadMock, apiPostFormDataMock } = vi.hoisted(() => ({
  apiGetMock: vi.fn(),
  apiPostMock: vi.fn(),
  apiDownloadMock: vi.fn(),
  apiPostFormDataMock: vi.fn()
}));

vi.mock("../api/client", () => ({
  apiGet: apiGetMock,
  apiPost: apiPostMock,
  apiDownload: apiDownloadMock,
  apiPostFormData: apiPostFormDataMock
}));

vi.mock("../components/WorkspaceHeader", () => ({
  WorkspaceHeader: (props: { activeTab: string }) => <div data-testid="workspace-header-tab">header:{props.activeTab}</div>
}));

vi.mock("../components/WorkspaceTabsContent", () => ({
  WorkspaceTabsContent: (props: { activeTab: string }) => <div data-testid="workspace-content-tab">tab:{props.activeTab}</div>
}));

vi.mock("../hooks/use-auth-control", () => ({
  useAuthControl: () => ({ canControlTelegramStream: false })
}));

vi.mock("../hooks/use-container-status-polling", () => ({
  useContainerStatusPolling: () => undefined
}));

vi.mock("../hooks/use-open-code-settings", () => ({
  useOpenCodeSettings: () => ({
    overview: null,
    activeFile: null,
    setActiveFile: vi.fn(),
    loadOverview: vi.fn(),
    openFile: vi.fn(),
    saveActiveFile: vi.fn(),
    createFile: vi.fn()
  })
}));

vi.mock("../hooks/use-opencode-version", () => ({
  useOpenCodeVersion: () => ({
    status: null,
    isLoading: false,
    isUpdating: false,
    loadStatus: vi.fn(),
    checkStatus: vi.fn(),
    updateNow: vi.fn()
  })
}));

vi.mock("../hooks/use-provider-auth", () => ({
  useProviderAuth: () => ({
    overview: null,
    isLoading: false,
    isSubmitting: false,
    oauthState: null,
    setOAuthState: vi.fn(),
    loadOverview: vi.fn(),
    startConnect: vi.fn(),
    submitApiKey: vi.fn(),
    completeOAuthAuto: vi.fn(),
    submitOAuthCode: vi.fn(),
    disconnect: vi.fn()
  })
}));

vi.mock("../hooks/use-project-git", () => ({
  useProjectGit: () => ({
    gitOverviewMap: {},
    loadGitOverview: vi.fn(),
    runGitOperation: vi.fn(),
    checkoutBranch: vi.fn(),
    mergeBranch: vi.fn(),
    commitAll: vi.fn()
  })
}));

vi.mock("../hooks/use-tab-memory", () => ({
  persistTabSelection: vi.fn(),
  readTabPersistenceState: () => ({ activeTab: "tasks", lastWorkspaceTab: "tasks" })
}));

vi.mock("../hooks/use-project-workspace", () => ({
  useProjectWorkspace: () => ({
    createProjectFolder: vi.fn(),
    cloneProjectRepository: vi.fn(),
    deleteProjectFolder: vi.fn()
  })
}));

vi.mock("../hooks/use-project-runtime", () => ({
  useProjectRuntime: () => ({
    runtime: null,
    isRuntimeLoading: false,
    isRuntimeSaving: false,
    loadRuntime: vi.fn(),
    saveSettings: vi.fn(),
    deployStart: vi.fn(),
    deployStop: vi.fn()
  })
}));

vi.mock("../hooks/use-cliproxy-accounts", () => ({
  useCliproxyAccounts: () => ({
    state: null,
    isLoading: false,
    isSubmitting: false,
    oauthStart: null,
    loadState: vi.fn(),
    startOAuth: vi.fn(),
    completeOAuth: vi.fn(),
    testAccount: vi.fn(),
    activateAccount: vi.fn(),
    deleteAccount: vi.fn()
  })
}));

vi.mock("../hooks/use-proxy-settings", () => ({
  useProxySettings: () => ({
    snapshot: null,
    isLoading: false,
    isSaving: false,
    isApplying: false,
    applyResult: null,
    loadSettings: vi.fn(),
    saveSettings: vi.fn(),
    applySettings: vi.fn()
  })
}));

vi.mock("../hooks/use-server-metrics", () => ({
  useServerMetrics: () => ({
    metrics: null,
    isLoading: false,
    loadMetrics: vi.fn()
  })
}));

vi.mock("../hooks/use-terminal-events", () => ({
  useTerminalEvents: () => ({ terminalBuffer: "", clearTerminalBuffer: vi.fn() })
}));

vi.mock("../hooks/use-voice-control-settings", () => ({
  useVoiceControlSettings: () => ({
    state: {
      apiKey: "",
      hasApiKey: false,
      model: null,
      supportedModels: [],
      isLoading: false,
      isSaving: false,
      isApiKeyDirty: false,
      saveResult: "idle"
    },
    setApiKey: vi.fn(),
    setModel: vi.fn(),
    loadSettings: vi.fn(),
    saveSettings: vi.fn()
  })
}));

vi.mock("../hooks/use-project-files", () => ({
  useProjectFiles: () => ({
    filePath: "",
    fileList: { entries: [] },
    filePreview: null,
    loadFiles: vi.fn(),
    openFile: vi.fn(),
    closeFilePreview: vi.fn(),
    resetFiles: vi.fn(),
    downloadFile: vi.fn(),
    uploadFileFromDevice: vi.fn(),
    importFileFromUrl: vi.fn()
  })
}));

vi.mock("../hooks/use-github-auth", () => ({
  useGithubAuth: () => ({
    state: null,
    loadStatus: vi.fn(),
    setTokenDraft: vi.fn(),
    saveToken: vi.fn(),
    disconnect: vi.fn()
  })
}));

vi.mock("../hooks/use-theme-mode", () => ({
  useThemeMode: () => ({ themeMode: "light", setThemeMode: vi.fn() })
}));

vi.mock("../utils/file-icons", () => ({ iconForFileEntry: vi.fn() }));
vi.mock("../utils/project-metadata", () => ({
  loadProjectMetadata: vi.fn(async () => ({ statusMap: {}, gitSummaryMap: {} }))
}));

describe("App kanban tab guard", () => {
  beforeEach(() => {
    /* Keep restore flow deterministic so the test only exercises the no-active-project tab fallback. */
    vi.clearAllMocks();
    localStorage.clear();

    apiGetMock.mockImplementation(async (path: string) => {
      if (path === "/api/projects") {
        return [{ id: "alpha", slug: "alpha", name: "Alpha", rootPath: "/srv/projects/alpha", runnable: true }];
      }
      if (path === "/api/projects/active") {
        return null;
      }
      return null;
    });
    apiPostMock.mockResolvedValue({});
  });

  it("falls back to Projects when the restored kanban tab has no active project", async () => {
    /* Project-scoped tabs should never remain selected after startup when no project is active. */
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("workspace-content-tab").textContent).toBe("tab:projects");
      expect(screen.getByTestId("workspace-header-tab").textContent).toBe("header:projects");
    });
  });
});
