# Core rules for Web development

- Responses in Russian
- Environment: Ubuntu
- Web search: use data relevant for 2026
- Project-specific rules have priority: if there is any conflict between global and project-level rules, always follow project-level rules.

## AI-Optimized Architecture

- TDD: tests → code → run → fix → repeat
- Modularity: related functionality in one folder
- Hard limit: strictly up to 500 lines per file (count total lines in the file). If a file exceeds this limit or is close to it, perform mandatory refactoring: extract logic into separate modules/hooks/sub-components.
  - Bugfixes are allowed in 500+ line files, but do not create new functionality “from scratch” inside such files.
  - Any new code and the directly related existing code must be extracted into a new file/module according to the project architecture.
- Context localization: everything related in one place
- Explicit dependencies: no hidden connections
- Isolated testing: tests next to code
- No invented defaults for required data/config
- Production ready software development
- Code comments are REQUIRED (explicit user requirement): add short comments for each logical block (“paragraph”) of code to explain intent, assumptions, invariants, edge-cases, and why the implementation is done this way. Avoid noise: do not comment obvious one-liners; prefer block comments that explain reasoning and non-trivial behavior.
- Named constants instead of magic numbers

### Anti-patterns for AI

- Global state
- Implicit dependencies
- Deep nesting (>3 levels)
- Hidden logic in middleware/decorators
- Complex patterns (Observer, Strategy)

## Task Execution Order

- You are a software engineer with access to project files, terminal/CLI, MCP servers, Docker containers, and the database (also in Docker). Do not wait for me to run commands manually – I fully delegate these technical tasks to you.

### 1. Analysis Phase

- Deeply and thoroughly study the current implementation and codebase structure
- During this analysis phase, pick the right MCP source:
  - Context7 MCP: use for library/framework references (API signatures, usage patterns, version-specific behavior, code examples).
  - DeepWiki MCP: use for repository-specific questions (where logic lives, architecture, entry points, data flow).
- If you're unsure about the best way to implement the logic, or there are multiple viable approaches, ask clarifying questions and briefly outline the pros and cons of each option.

### 2. Implementation Phase (TDD Workflow)

- **Test-First**: Begin by creating or updating tests to define the expected behavior _before_ writing the logic. Place tests in the `tests/` subfolder next to the module.
- Do not simplify tests at the expense of quality or coverage.
- **Execute & Validate**: Run tests to confirm failure (Red status) to ensure the test is valid and targeted.
- **Full Implementation**: Develop the code to satisfy requirements and pass all tests. Ensure the implementation is complete and robust (no stubs or hardcoded responses).
- **Adhere to Limits**: Continuously monitor the 500-line limit. If a file grows too large, immediately extract logic into hooks, helpers, or sub-components.
- **Environment**: Rebuild code and restart Docker containers as needed to apply and verify changes in the actual runtime.

### 3. Code Review

- Use the AI code review tool CodeRabbit to check code quality and identify potential issues.
- To run it, execute `coderabbit --prompt-only --type uncommitted` and wait for the output; it may take a few minutes.
- Do not treat CodeRabbit as 100% correct; it may miss important project-specific details, so validate recommendations against our code and architecture.
- Regardless of whether you used CodeRabbit, review all uncommitted changes yourself, evaluate implementation quality, and fix issues as needed.

### 4. Verification & Integration

- Run the full relevant test suite (Unit, Integration, E2E) to ensure no regressions.
- Use Chrome DevTools MCP for visual and interactive verification of the Frontend or Admin UI. Analyze screenshots to confirm layout integrity.
- After Chrome DevTools MCP testing, always close the browser session via the corresponding close-page/close-browser tool to avoid leaking sessions/resources.
- Cleanup after Chrome DevTools MCP checks: always delete all generated screenshots and test reports/artifacts, including runs triggered via MCP, unless the user explicitly asked to keep them.
- Verify database migrations and state changes directly within Docker containers if applicable.
- Cleanup: Remove temporary files, test-only mocks (if not persistent), and excessive debug logging.

### 5. File header standards

- **File Headers**: Every non-trivial `.js/.ts/.tsx` file must start with a detailed JSDoc header that acts as a TOC: list all important exports and key constructs (functions, classes, React components, hooks, constants, types/interfaces, routes/handlers), each with a short purpose. Do not include line numbers in JSDoc TOC entries.

### 6. Final Verification

- Run a final linter check on all modified files.
- Resolve any linting errors or type mismatches immediately.

### Forbidden

- !!!!No fallbacks strict policy!!!: do not invent default values to mask missing data.
- Definitions (to avoid ambiguity):
  - Required data/config: any value necessary to correctly execute business logic or an integration (env vars, secrets, IDs, auth tokens, required request params, required DB fields, required API payload fields). For required data/config, do NOT invent defaults, do NOT continue execution if missing; fail fast with an explicit error.
  - Optional/UI-only: values used only for presentation (labels, placeholders, display strings, cosmetic settings). Only for these, fallbacks/chained defaults are acceptable.
- try/catch is allowed only to add structured context (logging) and then re-throw the original error. Do not swallow errors, do not return fallbacks.
- Prefer catching only at boundary layers (API handlers, job runners, CLI entrypoints, integration adapters); inside domain logic let errors bubble up.
- No chained defaults in business logic: a or b or c only for UI labels; never for required config/data.
- No hidden retries: allowed only if explicitly requested, idempotent, transient errors, bounded attempts, logged.
- Fail fast: on invalid input or state — raise; do not continue with partial results.
- Observability: include structured logging on failure; do not downgrade severity (no silent warning where error is due).

### Library Versions

- Use Context7 MCP for up-to-date library/framework references
- Install only latest stable versions

## Git, Docker, CI/CD, GitHub, GitHub Actions, Deployment strategy

- Any merge into master is treated as a production deployment trigger and must be intentional
- Production Docker images (frontend and backend) must be built only from the canonical repository state (CI/CD pipeline from the master branch). Manual or local builds on the server from outdated sources are forbidden to avoid desynchronization between code and configuration.
- All environments (dev/prod) must be run only via Docker Compose.
- Migrations must always be executed inside the backend container via `npm run migrate`.
- In all environments the edge reverse proxy runs in Docker (Nginx or Traefik) and proxies traffic to the `frontend` and `backend` containers.
- **For development, prefer `stop`/`start` instead of `down` to preserve data and enable fast restarts.**

### Remote Dev Deploy Flow

- For remote dev on the shared VDS, prefer agent automation over manual per-project infra edits.
- Default flow for a new Docker project:
  1. `POST /api/projects/:id/deploy/autoconfigure` - infer public routes from compose (`web`, `api`, `admin`) without editing the project.
  2. Inspect returned `routes` + `previewUrl`.
  3. If needed, refine via `POST /api/projects/:id/deploy/settings` with explicit `routes`.
  4. Start exposure with `POST /api/projects/:id/deploy/start`.
- Keep server-specific deploy routing in backend runtime settings, not in project repo files.
- Do not rewrite project compose files just to fit the shared VDS unless autoconfig and runtime overrides are insufficient.

## Frontend development rules

- Navigation: any changes to menu, header, footer, or breadcrumbs are atomic and updated simultaneously in UI components and navigation configs.
- Routing: when adding/removing pages, sync routes everywhere (router, layouts, nav links, guards) so there are no dead paths.
- Types/props cleanup: after route/component edits, delete obsolete types, props, routes, and their imports to avoid dragging unused code.
- Unused scan: after each edit, run checks for unused imports/variables/components and remove the noise.
- Reuse first: before creating new UI, use existing components (toast, WYSIWYG, pagination, modals, etc.) and extend via options/composition, not copy-paste.
- Navigation blocks: header/menu/footer/breadcrumbs live as dedicated components without markup duplication; shared configs/constants stay in one place and are imported.

## Testing

- Risk-based testing only: prioritize critical business flows, core domain logic, integration boundaries, and regression-prone paths.
- Do not write tests for cosmetic-only UI changes (colors, spacing, typography, static layout) unless visual behavior is business-critical.
- Avoid "tests for tests": every test must protect a meaningful failure mode and provide long-term stability value.
- For UI, test behavior and user outcomes (state transitions, validation, permissions, error handling), not markup trivia.

### Jest (Unit)

- Test components where behavior is critical: user actions, state changes, guards, and error states
- Test hooks where logic is critical: state transitions, side effects, and failure handling

### Mocks

- For all external APIs and services
- Test all scenarios: success, errors, timeouts, retry
- Store mocks in separate folder

### Database

- Test migrations (table/column creation)
- Verify security policies and access rights
- Priority: local DB
