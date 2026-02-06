---
description: This command automates the process of committing changes to the develop branch.
auto_execution_mode: 3
---

# Git Add Command - Smart Commit to Develop

This command automates the process of committing changes to the develop branch.

## Task:
0. **FIRST STEP - Run linter and fix all errors:**
   - Run `npm run lint` to check for errors in all project packages — frontend, backend and any other important packages if they exist.
   - If errors found, analyze and fix them
   - Run linter again to verify all errors are fixed
   - Only proceed to commits when linter passes with no errors
1. Check current branch (should be develop, if not - switch to it)
2. Get list of all uncommitted changes (modified, new, deleted files)
3. Analyze changes and split them into logical commit categories
4. For each category:
   - Add corresponding files to staging (git add)
   - Create commit with meaningful message in Russian
5. **Push all commits to develop on GitHub (git push origin develop)**

## Commit Categorization Rules:
- **feat**: new files, components, functionality
- **fix**: bug fixes, error corrections
- **refactor**: code refactoring without functionality changes
- **style**: style changes, CSS, Tailwind
- **docs**: documentation changes (.md files in docs/)
- **test**: adding or modifying tests
- **chore**: configuration files, dependencies, scripts
- **perf**: performance optimization

## Commit Message Format:
```
<type>: <brief description in Russian>
```

Examples:
- `feat: добавление компонента ArticleCard для отображения статей`
- `fix: исправление ошибки загрузки изображений в темной теме`
- `docs: обновление документации API endpoints`

## Important:
- **ALWAYS start with running the linter and fixing any errors**
- If no changes exist, report it and finish
- If not on develop, switch to develop first
- **ALWAYS push to develop at the end (git push origin develop)**
- After completion show brief statistics: number of commits, files
- If you are given a task to commit, merge or run any other git commands, execute them in the command line without interactive input so that the process never blocks on commit message, password, or anything else. Commands must complete without human interaction.
- It is explicitly **forbidden** to invoke interactive editors (nano, vim, etc.) during merge/commit/rebase. Always provide commit and merge messages via flags (`-m`, `--no-edit`, `GIT_MERGE_AUTOEDIT=no`, etc.) so git commands run fully automatically.