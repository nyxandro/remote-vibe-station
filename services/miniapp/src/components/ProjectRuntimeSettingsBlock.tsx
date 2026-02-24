/**
 * @fileoverview Project runtime mode controls (docker/static) for Settings accordion.
 *
 * Exports:
 * - ProjectRuntimeSettingsBlock (L26) - Renders runtime settings form and deploy summary.
 */

import { useEffect, useRef, useState } from "react";

import { ProjectRuntimeMode, ProjectRuntimeSettingsPatch, ProjectRuntimeSnapshot } from "../types";

type Props = {
  activeId: string | null;
  snapshot: ProjectRuntimeSnapshot | null;
  isLoading: boolean;
  isSaving: boolean;
  onSaveSettings: (patch: ProjectRuntimeSettingsPatch) => void;
};

export const ProjectRuntimeSettingsBlock = (props: Props) => {
  const [mode, setMode] = useState<ProjectRuntimeMode | "">("");
  const [serviceName, setServiceName] = useState<string>("");
  const [internalPort, setInternalPort] = useState<string>("");
  const [staticRoot, setStaticRoot] = useState<string>("");
  const prevActiveIdRef = useRef<string | null>(null);
  const hasSnapshotRef = useRef<boolean>(false);

  useEffect(() => {
    /* Preserve in-progress edits and reset draft only on project switch or first snapshot load. */
    const projectChanged = prevActiveIdRef.current !== props.activeId;
    const snapshotBecameAvailable = !hasSnapshotRef.current && Boolean(props.snapshot);

    if (projectChanged || snapshotBecameAvailable) {
      setMode(props.snapshot?.mode ?? "");
      setServiceName(props.snapshot?.serviceName ?? "");
      setInternalPort(props.snapshot?.internalPort ? String(props.snapshot.internalPort) : "");
      setStaticRoot(props.snapshot?.staticRoot ?? "");
    }

    prevActiveIdRef.current = props.activeId;
    hasSnapshotRef.current = Boolean(props.snapshot);
  }, [props.activeId, props.snapshot]);

  /* Render deploy mode selector only when a project is selected. */
  if (!props.activeId) {
    return <div className="placeholder">Select a project to configure deploy mode.</div>;
  }

  const deployStatus = !props.snapshot ? "unknown" : props.snapshot.deployed ? "running" : "stopped";
  const modeValue = mode || props.snapshot?.mode || "";
  const requiresStaticRoot = modeValue === "static";
  const isStaticRootMissing = requiresStaticRoot && staticRoot.trim().length === 0;
  const hasPortDraft = internalPort.trim().length > 0;
  const parsedPort = hasPortDraft ? Number(internalPort.trim()) : null;
  const isInvalidPort = hasPortDraft && (!Number.isInteger(parsedPort) || (parsedPort ?? 0) <= 0 || (parsedPort ?? 0) > 65535);
  const dockerServicePresets = props.snapshot?.availableServices ?? [];

  const onSave = (): void => {
    /* Persist explicit form values; empty strings are normalized to null on backend. */
    if (!modeValue || isStaticRootMissing) {
      return;
    }

    const nextPort = hasPortDraft ? Number(internalPort.trim()) : null;
    props.onSaveSettings({
      mode: modeValue,
      serviceName: serviceName.trim().length > 0 ? serviceName.trim() : null,
      internalPort: Number.isInteger(nextPort) ? nextPort : null,
      staticRoot: staticRoot.trim().length > 0 ? staticRoot.trim() : null
    });
  };

  return (
    <>
      <label className="project-create-note" htmlFor="project-runtime-mode">
        Run mode
      </label>
      <select
        id="project-runtime-mode"
        className="input settings-input-compact"
        value={modeValue}
        disabled={props.isLoading || props.isSaving}
        onChange={(event) => {
          const value = event.target.value as ProjectRuntimeMode | "";
          setMode(value);
        }}
      >
        <option value="" disabled>
          {props.isLoading ? "Loading..." : "Select mode"}
        </option>
        <option value="docker">docker</option>
        <option value="static">static</option>
      </select>

      <label className="project-create-note" htmlFor="project-runtime-service-name">
        Docker service name
      </label>
      <input
        id="project-runtime-service-name"
        className="input settings-input-compact"
        placeholder="web"
        value={serviceName}
        disabled={props.isLoading || props.isSaving || modeValue === "static"}
        onChange={(event) => setServiceName(event.target.value)}
      />
      {modeValue === "docker" && dockerServicePresets.length > 0 ? (
        <div className="settings-actions-grid">
          {dockerServicePresets.map((service) => (
            <button
              key={service}
              className="btn outline"
              type="button"
              disabled={props.isLoading || props.isSaving}
              onClick={() => setServiceName(service)}
            >
              Use {service}
            </button>
          ))}
        </div>
      ) : null}

      <label className="project-create-note" htmlFor="project-runtime-internal-port">
        Docker internal port
      </label>
      <input
        id="project-runtime-internal-port"
        className="input settings-input-compact"
        placeholder="8080"
        value={internalPort}
        disabled={props.isLoading || props.isSaving || modeValue === "static"}
        onChange={(event) => setInternalPort(event.target.value)}
      />
      {isInvalidPort ? <div className="project-create-note">Docker internal port must be an integer in range 1-65535.</div> : null}

      <label className="project-create-note" htmlFor="project-runtime-static-root">
        Static root path
      </label>
      <input
        id="project-runtime-static-root"
        className="input settings-input-compact"
        placeholder="public"
        value={staticRoot}
        disabled={props.isLoading || props.isSaving || modeValue === "docker"}
        onChange={(event) => setStaticRoot(event.target.value)}
      />

      <button
        className="btn"
        type="button"
        disabled={props.isLoading || props.isSaving || !modeValue || isStaticRootMissing || isInvalidPort}
        onClick={onSave}
      >
        Save deploy settings
      </button>
      {isStaticRootMissing ? <div className="project-create-note">Static mode requires static root path.</div> : null}

      <div className="project-create-note">
        Preview URL: {props.snapshot?.previewUrl ?? "unknown"}
      </div>
      <div className="project-create-note">
        Deploy status: {deployStatus}
      </div>
      {props.isLoading ? <div className="project-create-note">Loading deploy settings...</div> : null}
      {props.isSaving ? <div className="project-create-note">Saving deploy settings...</div> : null}
    </>
  );
};
