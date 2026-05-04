/**
 * @fileoverview Tests for App file tree refresh behavior on tab entry.
 */

/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  WorkspaceHeader: (props: { onSetTab: (tab: string) => void }) => (
    <div>
      <button onClick={() => props.onSetTab("projects")} type="button">
        Projects
      </button>
      <button onClick={() => props.onSetTab("files")} type="button">
        Files
      </button>
    </div>
  )
}));

vi.mock("../components/WorkspaceTabsContent", () => ({
  WorkspaceTabsContent: (props: { activeTab: string }) => <div>tab:{props.activeTab}</div>
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
  readTabPersistenceState: () => ({ activeTab: "projects", lastWorkspaceTab: "projects" })
}));

vi.mock("../hooks/use-project-workspace", () => ({
  useProjectWorkspace: () => ({
    createProjectFolder: vi.fn(),
    cloneProjectRepository: vi.fn(),
    deleteProjectFolder: vi.fn()
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
    completeOAuth: vi.fn()
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

vi.mock("../utils/file-icons", () => ({ iconForFileEntry: vi.fn() }));
vi.mock("../utils/project-metadata", () => ({
  loadProjectMetadata: vi.fn(async () => ({ statusMap: {}, gitSummaryMap: {} }))
}));
vi.mock("../utils/syntax", () => ({ highlightToHtml: vi.fn(async () => "") }));
vi.mock("../utils/theme", () => ({
  applyThemeToDocument: vi.fn(),
  readStoredThemeMode: () => "light"
}));

describe("App files refresh", () => {
  beforeEach(() => {
    /* Reset network mocks and local storage so tab-enter behavior stays deterministic. */
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("tvoc.miniapp.activeProject", "carusel");

    apiGetMock.mockImplementation(async (path: string) => {
      if (path === "/api/projects") {
        return [{ id: "carusel", slug: "carusel", name: "carusel", rootPath: "/srv/projects/carusel", runnable: true }];
      }
      if (path === "/api/projects/active") {
        return null;
      }
      if (path.startsWith("/api/projects/carusel/files")) {
        return { entries: [] };
      }
      return null;
    });
    apiPostMock.mockResolvedValue({});
  });

  it("reloads file tree automatically when entering files tab", async () => {
    /* Entering the Files tab should trigger the same refresh as manual reload button. */
    render(<App />);

    await waitFor(() => {
      expect(apiGetMock).toHaveBeenCalledWith("/api/projects");
    });

    fireEvent.click(screen.getByRole("button", { name: "Files" }));

    await waitFor(() => {
      expect(apiGetMock).toHaveBeenCalledWith("/api/projects/carusel/files");
    });
  });
});
