/**
 * @fileoverview Reusable Trello-like kanban board for project and global views.
 *
 * Exports:
 * - KanbanBoard - Renders columns, cards, filters, drag-and-drop, and editor modal.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Plus, Search, X } from "lucide-react";

import { useDraggableScroll } from "../hooks/use-draggable-scroll";
import { CreateKanbanTaskPayload, UpdateKanbanTaskPayload } from "../hooks/use-kanban";
import { KanbanTaskEditorModal, KanbanTaskEditorSubmit } from "./KanbanTaskEditorModal";
import { KanbanTaskCard } from "./KanbanTaskCard";
import { clearStoredKanbanTaskEditorDraft } from "./kanban-task-editor-draft";
import { KanbanPriority, KanbanStatus, KanbanTask, ProjectRecord } from "../types";
import { ThemeMode } from "../utils/theme";

const COLUMN_PAGE_SIZE = 10;

const COLUMNS: Array<{ status: KanbanStatus; label: string; emptyText: string }> = [
  { status: "backlog", label: "Backlog", emptyText: "Store raw ideas here before grooming starts." },
  { status: "refinement", label: "Plan", emptyText: "Clarify scope, inputs, acceptance criteria, and rollout plan here." },
  { status: "ready", label: "Ready", emptyText: "Prepared tasks wait here until you intentionally queue them." },
  { status: "queued", label: "Queue", emptyText: "Approved tasks wait here for execution pickup." },
  { status: "in_progress", label: "In progress", emptyText: "Agent-claimed work appears here." },
  { status: "blocked", label: "Blocked", emptyText: "Waiting for clarification or dependency." },
  { status: "done", label: "Done", emptyText: "Completed tasks stay here for review." }
];

const PRIORITY_LABELS: Record<KanbanPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High"
};

const COLUMN_STYLE_CLASS: Record<KanbanStatus, string> = {
  backlog: "kanban-column-backlog",
  refinement: "kanban-column-refinement",
  ready: "kanban-column-ready",
  queued: "kanban-column-queued",
  in_progress: "kanban-column-in-progress",
  blocked: "kanban-column-blocked",
  done: "kanban-column-done"
};

type Props = {
  scope: "project" | "global";
  tasks: KanbanTask[];
  projects: ProjectRecord[];
  activeProjectSlug: string | null;
  initialProjectFilter?: string | null;
  isLoading: boolean;
  isSaving: boolean;
  themeMode?: ThemeMode;
  onCreateTask: (payload: CreateKanbanTaskPayload) => Promise<void> | void;
  onDeleteTask?: (taskId: string) => Promise<void> | void;
  onUpdateTask: (taskId: string, patch: UpdateKanbanTaskPayload) => Promise<void> | void;
  onMoveTask: (taskId: string, status: KanbanStatus) => void;
  onOpenGlobalBoard?: () => void;
};

const createInitialColumnVisibleCounts = (): Record<KanbanStatus, number> => ({
  backlog: COLUMN_PAGE_SIZE,
  refinement: COLUMN_PAGE_SIZE,
  ready: COLUMN_PAGE_SIZE,
  queued: COLUMN_PAGE_SIZE,
  in_progress: COLUMN_PAGE_SIZE,
  blocked: COLUMN_PAGE_SIZE,
  done: COLUMN_PAGE_SIZE
});

export const KanbanBoard = (props: Props) => {
  const [search, setSearch] = useState<string>("");
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [projectFilter, setProjectFilter] = useState<string>(props.initialProjectFilter ?? "all");
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dropStatus, setDropStatus] = useState<KanbanStatus | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false);
  const [editingTask, setEditingTask] = useState<KanbanTask | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [columnVisibleCounts, setColumnVisibleCounts] = useState<Record<KanbanStatus, number>>(createInitialColumnVisibleCounts);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const columnRefs = useRef<Partial<Record<KanbanStatus, HTMLElement | null>>>({});
  const autoPositionedViewKeyRef = useRef<string | null>(null);

  const { ref: boardRef, isDragging: isBoardDragging, handlers: boardHandlers } = useDraggableScroll();

  useEffect(() => {
    /* Project-scoped boards follow the active project selection automatically. */
    if (props.scope === "project") {
      setProjectFilter(props.activeProjectSlug ?? "all");
      return;
    }
    if (props.initialProjectFilter) {
      setProjectFilter(props.initialProjectFilter);
    }
  }, [props.activeProjectSlug, props.initialProjectFilter, props.scope]);

  useEffect(() => {
    /* Focus the search field only after the expanding search shell has mounted. */
    if (!isSearchOpen) {
      return;
    }
    searchInputRef.current?.focus();
  }, [isSearchOpen]);

  const filteredTasks = useMemo(() => {
    /* Search/filter stays client-side so the board feels immediate while the backend remains simple. */
    const normalizedSearch = search.trim().toLowerCase();
    const activeProjectSlug = props.scope === "project" ? props.activeProjectSlug : projectFilter === "all" ? null : projectFilter;

    return props.tasks.filter((task) => {
      if (activeProjectSlug && task.projectSlug !== activeProjectSlug) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }
      const haystack = [task.title, task.description, task.projectName, ...task.acceptanceCriteria.map((criterion) => criterion.text)]
        .join("\n")
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [projectFilter, props.activeProjectSlug, props.scope, props.tasks, search]);

  const filteredViewKey = useMemo(() => {
    /* Auto-positioning should reset only when the visible board context changes. */
    const normalizedSearch = search.trim().toLowerCase();
    const effectiveProjectSlug = props.scope === "project" ? props.activeProjectSlug ?? "all" : projectFilter;
    return `${props.scope}|${effectiveProjectSlug}|${normalizedSearch}`;
  }, [projectFilter, props.activeProjectSlug, props.scope, search]);

  useEffect(() => {
    /* Filter changes should collapse every column back to the first page so pagination stays predictable. */
    setColumnVisibleCounts(createInitialColumnVisibleCounts());
  }, [filteredTasks]);

  const tasksByStatus = useMemo(() => {
    /* Pre-group cards per column and sort by last update so the newest activity always surfaces first. */
    const buckets: Record<KanbanStatus, KanbanTask[]> = {
      backlog: [],
      refinement: [],
      ready: [],
      queued: [],
      in_progress: [],
      blocked: [],
      done: []
    };

    for (const task of filteredTasks) {
      const bucket = buckets[task.status];
      if (!bucket) {
        continue;
      }
      bucket.push(task);
    }

    /* Stable newest-first order keeps each column focused on recent work rather than original creation time. */
    for (const status of Object.keys(buckets) as KanbanStatus[]) {
      buckets[status].sort((left, right) => {
        const updatedDiff = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
        if (updatedDiff !== 0) {
          return updatedDiff;
        }

        const createdDiff = Date.parse(right.createdAt) - Date.parse(left.createdAt);
        if (createdDiff !== 0) {
          return createdDiff;
        }
        return right.id.localeCompare(left.id);
      });
    }

    return buckets;
  }, [filteredTasks]);

  const firstNonEmptyStatus = useMemo(() => {
    /* Mobile boards should land on the nearest useful column instead of always starting at empty backlog. */
    return COLUMNS.find((column) => tasksByStatus[column.status].length > 0)?.status ?? null;
  }, [tasksByStatus]);

  useEffect(() => {
    /* Auto-scroll once per visible board context so live updates do not keep yanking the user sideways. */
    if (!boardRef.current || !firstNonEmptyStatus) {
      return;
    }

    if (autoPositionedViewKeyRef.current === filteredViewKey) {
      return;
    }

    const targetColumn = columnRefs.current[firstNonEmptyStatus];
    if (!targetColumn) {
      return;
    }

    /* jsdom lacks scrollTo(), so keep a scrollLeft fallback while browsers still get smooth positioning. */
    if (typeof boardRef.current.scrollTo === "function") {
      boardRef.current.scrollTo({ left: targetColumn.offsetLeft, behavior: "smooth" });
    } else {
      boardRef.current.scrollLeft = targetColumn.offsetLeft;
    }

    autoPositionedViewKeyRef.current = filteredViewKey;
  }, [boardRef, filteredViewKey, firstNonEmptyStatus]);

  const handleEditorSubmit = async (payload: KanbanTaskEditorSubmit): Promise<void> => {
    /* Create and edit dialogs both feed the board through one normalized payload shape. */
    setEditorError(null);

    try {
      if (editingTask) {
        /* Once [] means "unchanged" server-side, the UI must mark intentional full checklist clears explicitly. */
        const clearAcceptanceCriteria = editingTask.acceptanceCriteria.length > 0 && payload.acceptanceCriteria.length === 0;

        await props.onUpdateTask(editingTask.id, {
          title: payload.title,
          description: payload.description,
          status: payload.status,
          priority: payload.priority,
          acceptanceCriteria: payload.acceptanceCriteria,
          ...(clearAcceptanceCriteria ? { clearAcceptanceCriteria: true } : {}),
          resultSummary: payload.resultSummary,
          blockedReason: payload.blockedReason
        });
        setEditingTask(null);
        return;
      }

      await props.onCreateTask({
        projectSlug: payload.projectSlug,
        title: payload.title,
        description: payload.description,
        status: payload.status,
        priority: payload.priority,
        acceptanceCriteria: payload.acceptanceCriteria
      });

      /* Successful creation consumes the saved draft so reopening the modal starts clean for that project. */
      clearStoredKanbanTaskEditorDraft({ scope: props.scope, projectSlug: payload.projectSlug });
      clearStoredKanbanTaskEditorDraft({ scope: props.scope, projectSlug: "" });
      setIsCreateOpen(false);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "Failed to save task");
    }
  };

  const handleEditorDelete = async (): Promise<void> => {
    /* Keep delete failures in the shared editor alert area instead of closing the modal and losing context. */
    if (!editingTask || !props.onDeleteTask) {
      return;
    }

    setEditorError(null);
    try {
      await props.onDeleteTask(editingTask.id);
      setEditingTask(null);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "Failed to delete task");
    }
  };

  return (
    <section className="kanban-shell">
      <div className={isSearchOpen ? "kanban-toolbar kanban-toolbar-search-open" : "kanban-toolbar"}>
        {isSearchOpen ? (
          <div className="kanban-search-shell">
            <Search size={16} className="kanban-search-shell-icon" />
            <input
              ref={searchInputRef}
              className="input kanban-search-input"
              placeholder="Search tasks…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button
              className="btn outline kanban-toolbar-icon-button"
              onClick={() => setIsSearchOpen(false)}
              type="button"
              aria-label="Close search"
              title="Close search"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <>
            {props.scope === "global" ? (
              <select
                className="input kanban-project-filter kanban-project-filter-compact"
                value={projectFilter}
                onChange={(event) => setProjectFilter(event.target.value)}
                aria-label="Filter by project"
              >
                <option value="all">All projects</option>
                {props.projects.map((project) => (
                  <option key={project.id} value={project.slug}>
                    {project.name}
                  </option>
                ))}
              </select>
            ) : null}

            <div className="kanban-toolbar-side">
              <div className="kanban-toolbar-actions">
                <button
                  className="btn outline kanban-toolbar-icon-button"
                  onClick={() => setIsSearchOpen(true)}
                  type="button"
                  aria-label="Open search"
                  title="Search tasks"
                >
                  <Search size={16} />
                </button>

                {props.onOpenGlobalBoard ? (
                  <button
                    className="btn outline kanban-toolbar-icon-button"
                    onClick={props.onOpenGlobalBoard}
                    type="button"
                    aria-label="Open shared board"
                    title="Open shared board"
                  >
                    <ExternalLink size={16} />
                  </button>
                ) : null}

                <button
                  className="btn primary kanban-toolbar-icon-button"
                  onClick={() => setIsCreateOpen(true)}
                  type="button"
                  aria-label="Create new task"
                  title="Create new task"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      {editorError ? <div className="alert">{editorError}</div> : null}

      <div 
        ref={boardRef}
        {...boardHandlers}
        className={isBoardDragging ? "kanban-columns kanban-columns-dragging" : "kanban-columns"}
      >
        {COLUMNS.map((column) => (
          <section
            key={column.status}
            ref={(node) => {
              /* Keep stable DOM anchors per status so board auto-positioning can target the first useful column. */
              columnRefs.current[column.status] = node;
            }}
            className={
              dropStatus === column.status
                ? `kanban-column ${COLUMN_STYLE_CLASS[column.status]} kanban-column-active`
                : `kanban-column ${COLUMN_STYLE_CLASS[column.status]}`
            }
            onDragOver={(event) => {
              /* Columns accept card drops and highlight only while a drag operation is active. */
              event.preventDefault();
              setDropStatus(column.status);
            }}
            onDragLeave={() => setDropStatus((current) => (current === column.status ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              if (dragTaskId) {
                void props.onMoveTask(dragTaskId, column.status);
              }
              setDragTaskId(null);
              setDropStatus(null);
            }}
          >
            <header className="kanban-column-header">
              <div className="kanban-column-header-content">
                <div className="kanban-column-title">{column.label}</div>
                {tasksByStatus[column.status].length > 0 ? (
                  <span className="kanban-column-count">
                    {tasksByStatus[column.status].length > 99 ? "99+" : tasksByStatus[column.status].length}
                  </span>
                ) : <span className="kanban-column-count-empty" />}
              </div>
            </header>

            <div className="kanban-column-body">
              {tasksByStatus[column.status].length === 0 ? (
                <div className="kanban-empty-state">{props.isLoading ? "Loading…" : column.emptyText}</div>
              ) : null}

              {tasksByStatus[column.status].slice(0, columnVisibleCounts[column.status]).map((task) => (
                <KanbanTaskCard
                  key={task.id}
                  task={task}
                  scope={props.scope}
                  priorityLabel={PRIORITY_LABELS[task.priority]}
                  onOpen={() => setEditingTask(task)}
                  onDragStart={() => setDragTaskId(task.id)}
                  onDragEnd={() => {
                    setDragTaskId(null);
                    setDropStatus(null);
                  }}
                />
              ))}

              {tasksByStatus[column.status].length > columnVisibleCounts[column.status] ? (
                <button
                  className="btn outline kanban-load-more-button"
                  type="button"
                  onClick={() => {
                    /* Reveal the next slice in-place so long columns stay compact without hiding older work completely. */
                    setColumnVisibleCounts((current) => ({
                      ...current,
                      [column.status]: current[column.status] + COLUMN_PAGE_SIZE
                    }));
                  }}
                >
                  ЗАГРУЗИТЬ ЕЩЕ
                </button>
              ) : null}
            </div>
          </section>
        ))}
      </div>

      {isCreateOpen ? (
        <KanbanTaskEditorModal
          mode="create"
          scope={props.scope}
          activeProjectSlug={props.activeProjectSlug}
          projects={props.projects}
          isSaving={props.isSaving}
          themeMode={props.themeMode}
          onClose={() => setIsCreateOpen(false)}
          onSubmit={handleEditorSubmit}
        />
      ) : null}

      {editingTask ? (
        <KanbanTaskEditorModal
          mode="edit"
          scope={props.scope}
          activeProjectSlug={props.activeProjectSlug}
          projects={props.projects}
          task={editingTask}
          isSaving={props.isSaving}
          themeMode={props.themeMode}
          onClose={() => setEditingTask(null)}
          onDelete={props.onDeleteTask ? handleEditorDelete : undefined}
          onSubmit={handleEditorSubmit}
        />
      ) : null}
    </section>
  );
};
