/**
 * @fileoverview Mobile-first OpenCode skills management tab.
 *
 * Exports:
 * - SkillsTab - Renders search, filter chips, install/remove actions, and live install progress.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Hash,
  Loader2,
  PackageCheck,
  PackagePlus,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Trash2,
  X
} from "lucide-react";

import {
  InstalledOpenCodeSkill,
  NeuralDeepSkillCatalogItem,
  SkillCatalogFilter
} from "../types";
import { SkillMutationKind, SkillMutationStatus } from "../hooks/use-opencode-skills";

type Props = {
  catalog: NeuralDeepSkillCatalogItem[];
  installedSkills: InstalledOpenCodeSkill[];
  isLoading: boolean;
  mutatingSkillName: string | null;
  mutatingKind: SkillMutationKind | null;
  mutationStartedAt: number | null;
  mutationStatus: SkillMutationStatus | null;
  onSearch: (query: string, filter: SkillCatalogFilter) => Promise<void> | void;
  onInstall: (
    skill: { id: string; name: string; owner: string | null; repo: string | null },
    query: string,
    filter: SkillCatalogFilter
  ) => Promise<void> | void;
  onUninstall: (name: string, query: string, filter: SkillCatalogFilter) => Promise<void> | void;
  onDismissStatus: () => void;
};

type FilterOption = { value: SkillCatalogFilter; label: string };

const FILTER_OPTIONS: FilterOption[] = [
  { value: "all", label: "Все" },
  { value: "available", label: "Доступные" },
  { value: "installed", label: "Установленные" }
];

/* Debounce delay keeps NeuralDeep search reactive without hammering the upstream API. */
const SEARCH_DEBOUNCE_MS = 350;

/* Client-side pagination: NeuralDeep returns the full catalog in one array, so we cap
   what the user sees and let them request the next page on demand. */
const PAGE_SIZE = 20;

/* Smooth ramp tunable for the install/uninstall progress bar. Larger = slower ramp. */
const PROGRESS_RAMP_TAU_MS = 1800;

/* Progress polling tick — high enough for smooth animation, cheap enough to be free. */
const PROGRESS_TICK_MS = 80;

/* Phase narration thresholds (ms since mutation start) — text-only hints, no real backend phases. */
const INSTALL_PHASES: Array<{ at: number; text: string }> = [
  { at: 0, text: "Подготовка..." },
  { at: 600, text: "Загрузка SKILL.md из NeuralDeep..." },
  { at: 1800, text: "Сохранение в OpenCode..." },
  { at: 3500, text: "Почти готово..." }
];

const UNINSTALL_PHASES: Array<{ at: number; text: string }> = [
  { at: 0, text: "Удаляем файлы скилла..." },
  { at: 1200, text: "Обновляем каталог..." }
];

const formatCount = (value: number | null): string => {
  /* Display-only counts may be absent from catalog rows. */
  return typeof value === "number" ? value.toLocaleString("ru-RU") : "—";
};

const pickPhaseText = (kind: SkillMutationKind, elapsedMs: number): string => {
  /* Return the latest phase whose threshold has been crossed. */
  const phases = kind === "install" ? INSTALL_PHASES : UNINSTALL_PHASES;
  let current = phases[0].text;
  for (const phase of phases) {
    if (elapsedMs >= phase.at) {
      current = phase.text;
    }
  }
  return current;
};

export const SkillsTab = (props: Props) => {
  const [query, setQuery] = useState<string>("");
  const [filter, setFilter] = useState<SkillCatalogFilter>("all");
  /* Track elapsed mutation time locally so progress UI stays smooth between renders. */
  const [progressTick, setProgressTick] = useState<number>(0);
  /* Visible window for client-side pagination — grows by PAGE_SIZE on each "load more" click. */
  const [visibleCount, setVisibleCount] = useState<number>(PAGE_SIZE);

  const isInitialLoadRef = useRef<boolean>(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Initial load + reactive auto-search on query/filter change with debounce. */
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    /* First render fires immediately to populate the tab; subsequent edits debounce. */
    const delay = isInitialLoadRef.current ? 0 : SEARCH_DEBOUNCE_MS;
    isInitialLoadRef.current = false;
    debounceRef.current = setTimeout(() => {
      void props.onSearch(query, filter);
    }, delay);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, filter, props.onSearch]);

  /* Drive the progress animation while a mutation is in flight. */
  useEffect(() => {
    if (!props.mutatingSkillName) {
      setProgressTick(0);
      return;
    }
    const interval = setInterval(() => setProgressTick((value) => value + 1), PROGRESS_TICK_MS);
    return () => clearInterval(interval);
  }, [props.mutatingSkillName]);

  /* Auto-dismiss success toast after a short delay so users keep their visual focus on the catalog. */
  useEffect(() => {
    if (!props.mutationStatus || props.mutationStatus.outcome !== "success") {
      return;
    }
    const timer = setTimeout(() => props.onDismissStatus(), 3500);
    return () => clearTimeout(timer);
  }, [props.mutationStatus, props.onDismissStatus]);

  const elapsedMs = props.mutationStartedAt ? Date.now() - props.mutationStartedAt : 0;
  /* Exponential ramp asymptotes toward 0.9; success snap-to-100 happens via mutation-end re-render. */
  const progressFraction = props.mutatingSkillName
    ? Math.min(0.92, 1 - Math.exp(-elapsedMs / PROGRESS_RAMP_TAU_MS))
    : 0;
  const progressPercent = Math.round(progressFraction * 100);

  /* For "installed" filter: render local list (always accurate) enriched by remote catalog metadata. */
  const installedView = useMemo(() => {
    const catalogByName = new Map<string, NeuralDeepSkillCatalogItem>();
    for (const item of props.catalog) {
      catalogByName.set(item.name, item);
    }
    return props.installedSkills.map<NeuralDeepSkillCatalogItem>((local) => {
      const matched = catalogByName.get(local.name);
      if (matched) {
        return { ...matched, installed: true };
      }
      /* Locally installed skill missing from remote catalog still needs a card with safe defaults. */
      return {
        id: `local:${local.name}`,
        name: local.name,
        owner: null,
        repo: null,
        description: local.relativePath,
        installs: null,
        trending24h: null,
        category: null,
        tags: [],
        featured: false,
        githubStars: null,
        type: null,
        installed: true
      };
    });
  }, [props.installedSkills, props.catalog]);

  const allItems = filter === "installed" ? installedView : props.catalog;
  /* Reset the visible window whenever the underlying dataset changes (search/filter/refresh). */
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [query, filter, allItems.length]);

  const visibleItems = allItems.slice(0, visibleCount);
  const hasMore = visibleItems.length < allItems.length;
  const remainingCount = allItems.length - visibleItems.length;

  const onSubmitSearch = (): void => {
    /* Manual submit just bypasses debounce — same dataflow path. */
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    void props.onSearch(query, filter);
  };

  const onClearQuery = (): void => {
    setQuery("");
  };

  const showSkeletons = props.isLoading && visibleItems.length === 0;

  return (
    <div className="skills-shell">
      {/* Hero block keeps the section identity visible even when scrolling between cards. */}
      <header className="skills-hero">
        <div className="skills-hero-title">
          <Sparkles size={18} aria-hidden />
          <span>OpenCode Skills</span>
        </div>
        <div className="skills-hero-meta">
          <span className="skills-hero-counter">
            <PackageCheck size={14} aria-hidden />
            {props.installedSkills.length} установлено
          </span>
        </div>
      </header>

      {/* Sticky search and filter — primary controls stay accessible while scrolling. */}
      <div className="skills-controls">
        <label className="skills-search">
          <Search size={16} aria-hidden />
          <input
            className="skills-search-input"
            type="search"
            inputMode="search"
            autoComplete="off"
            aria-label="Поиск скиллов"
            placeholder="Поиск, например seo или yandex"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSubmitSearch();
              }
            }}
          />
          {query.length > 0 ? (
            <button
              type="button"
              className="skills-search-clear"
              aria-label="Очистить поиск"
              onClick={onClearQuery}
            >
              <X size={14} aria-hidden />
            </button>
          ) : null}
        </label>

        <div className="skills-filter" role="tablist" aria-label="Фильтр скиллов">
          {FILTER_OPTIONS.map((option) => (
            <button
              key={option.value}
              role="tab"
              aria-selected={filter === option.value}
              className={`skills-filter-chip${filter === option.value ? " is-active" : ""}`}
              onClick={() => setFilter(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Toast — inline status banner with explicit dismiss. */}
      {props.mutationStatus ? (
        <div
          className={`skills-toast skills-toast-${props.mutationStatus.outcome}`}
          role="status"
          aria-live="polite"
        >
          {props.mutationStatus.outcome === "success" ? (
            <CheckCircle2 size={16} aria-hidden />
          ) : (
            <AlertCircle size={16} aria-hidden />
          )}
          <span className="skills-toast-text">{props.mutationStatus.message}</span>
          <button
            type="button"
            className="skills-toast-close"
            aria-label="Скрыть сообщение"
            onClick={props.onDismissStatus}
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      ) : null}

      {/* List of skill cards. Skeletons keep layout stable during initial fetch. */}
      <div className="skills-list" aria-busy={props.isLoading}>
        {showSkeletons
          ? Array.from({ length: 4 }).map((_, index) => (
              <div className="skill-card skill-card-skeleton" key={`sk-${index}`} aria-hidden>
                <div className="skeleton skeleton-line skeleton-line-title" />
                <div className="skeleton skeleton-line" />
                <div className="skeleton skeleton-line skeleton-line-short" />
              </div>
            ))
          : null}

        {!showSkeletons && visibleItems.length === 0 ? (
          <div className="skills-empty">
            <Search size={20} aria-hidden />
            <div className="skills-empty-title">
              {filter === "installed"
                ? "Скиллы пока не установлены."
                : "Ничего не нашлось по этому запросу."}
            </div>
            <div className="skills-empty-hint">
              {filter === "installed"
                ? "Откройте вкладку «Все» и установите нужные скиллы."
                : "Попробуйте другой поисковый запрос или фильтр."}
            </div>
          </div>
        ) : null}

        {!showSkeletons
          ? visibleItems.map((skill) => {
              /* Each card colocates remote metadata with local install actions and live progress. */
              const isBusy = props.mutatingSkillName === skill.name;
              const phaseText =
                isBusy && props.mutatingKind ? pickPhaseText(props.mutatingKind, elapsedMs) : null;

              return (
                <article
                  key={skill.id}
                  className={`skill-card${isBusy ? " is-busy" : ""}${
                    skill.installed ? " is-installed" : ""
                  }`}
                >
                  <div className="skill-card-head">
                    <h3 className="skill-card-name">{skill.name}</h3>
                    <span className={`skill-badge${skill.installed ? " is-installed" : ""}`}>
                      {skill.installed ? "Установлен" : "Доступен"}
                    </span>
                  </div>

                  {skill.description ? (
                    <p className="skill-card-desc">{skill.description}</p>
                  ) : null}

                  <div className="skill-card-meta">
                    {skill.category ? (
                      <span className="skill-meta-chip">
                        <Hash size={12} aria-hidden />
                        {skill.category}
                      </span>
                    ) : null}
                    <span className="skill-meta-chip">
                      <PackageCheck size={12} aria-hidden />
                      {formatCount(skill.installs)}
                    </span>
                    <span className="skill-meta-chip">
                      <Star size={12} aria-hidden />
                      {formatCount(skill.githubStars)}
                    </span>
                  </div>

                  {skill.tags.length > 0 ? (
                    <div className="skill-tags">
                      {skill.tags.slice(0, 6).map((tag) => (
                        <span key={`${skill.id}:${tag}`} className="skill-tag">
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="skill-card-actions">
                    {skill.installed ? (
                      <button
                        type="button"
                        className="skill-action skill-action-danger"
                        disabled={isBusy}
                        onClick={() => void props.onUninstall(skill.name, query, filter)}
                      >
                        {isBusy && props.mutatingKind === "uninstall" ? (
                          <Loader2 size={16} className="skill-spin" aria-hidden />
                        ) : (
                          <Trash2 size={16} aria-hidden />
                        )}
                        <span>{isBusy ? "Удаление..." : "Удалить"}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="skill-action skill-action-primary"
                        disabled={isBusy}
                        onClick={() =>
                          void props.onInstall(
                            { id: skill.id, name: skill.name, owner: skill.owner, repo: skill.repo },
                            query,
                            filter
                          )
                        }
                      >
                        {isBusy && props.mutatingKind === "install" ? (
                          <Loader2 size={16} className="skill-spin" aria-hidden />
                        ) : (
                          <PackagePlus size={16} aria-hidden />
                        )}
                        <span>{isBusy ? "Установка..." : "Установить"}</span>
                      </button>
                    )}
                  </div>

                  {/* Progress overlay — visible only while this card's mutation is in flight. */}
                  {isBusy ? (
                    <div className="skill-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}>
                      <div className="skill-progress-track">
                        <div
                          className="skill-progress-fill"
                          data-tick={progressTick}
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                      <div className="skill-progress-meta">
                        <span className="skill-progress-text">{phaseText}</span>
                        <span className="skill-progress-pct">{progressPercent}%</span>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })
          : null}
      </div>

      {/* Load-more pager — visible only when more items exist beyond the current window. */}
      {!showSkeletons && hasMore ? (
        <div className="skills-pager">
          <button
            type="button"
            className="skills-load-more"
            disabled={props.isLoading || Boolean(props.mutatingSkillName)}
            onClick={() => setVisibleCount((current) => current + PAGE_SIZE)}
          >
            <span>Загрузить ещё</span>
            <span className="skills-load-more-count">
              +{Math.min(PAGE_SIZE, remainingCount)} из {remainingCount}
            </span>
          </button>
        </div>
      ) : null}

      {/* Manual refresh — useful when NeuralDeep changes outside the user's session. */}
      <div className="skills-footer">
        <button
          type="button"
          className="skills-refresh"
          disabled={props.isLoading || Boolean(props.mutatingSkillName)}
          onClick={onSubmitSearch}
        >
          <RefreshCw size={14} className={props.isLoading ? "skill-spin" : undefined} aria-hidden />
          <span>{props.isLoading ? "Обновляем..." : "Обновить каталог"}</span>
        </button>
      </div>
    </div>
  );
};
