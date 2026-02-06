---
description: This command automates the process of committing changes to develop and merging to master to trigger deployment.
auto_execution_mode: 3
---

# Git Add Master Command - Commit and Deploy to Production

This command automates the process of committing changes to develop and merging to master to trigger deployment.

## Task:

### STEP 0 - ALWAYS RUN FIRST - Linter Check and Fix:
**CRITICAL: This step MUST be executed BEFORE any git operations**
1. Run `npm run lint` to check for errors in all project packages — frontend, backend and any other important packages if they exist.
2. If errors found:
   - Analyze each error carefully
   - Fix all errors in the code
   - Run linter again to verify
3. Repeat until linter passes with 0 errors
4. **Only proceed to git operations after linter is clean**

### If there are uncommitted changes:
1. Switch to develop branch (if not on it)
2. Get list of all uncommitted changes
3. Analyze changes and split them into logical commit categories
4. For each category:
   - Add corresponding files to staging (git add)
   - Create commit with meaningful message in Russian
5. Push commits to develop (git push origin develop)
6. Switch to master
7. Merge develop into master (git merge develop)
8. Push master to GitHub (git push origin master) - this will trigger GitHub Actions deployment
9. Return to develop branch

### If everything is already committed in develop:
1. Check that we are on develop
2. Push develop if there are unpushed commits (git push origin develop)
3. Switch to master
4. Merge develop into master (git merge develop)
5. Push master to GitHub (git push origin master)
6. Return to develop branch

## Commit Categorization Rules (for uncommitted changes):
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

## Master Merge Message Format:
```
merge: <brief description of all changes from develop>
```

Example:
- `merge: добавление 404 страниц и исправление темной темы`

## Important:
- **CRITICAL: ALWAYS start with linter check - do NOT skip this step**
- Before merging, ensure all tests passed (if any)
- After push to master, GitHub Actions deployment should start
- Always return to develop at the end
- Show brief statistics: number of commits, what was merged, deployment status
- If you are given a task to commit, merge or run any other git commands, execute them in the command line without interactive input so that the process never blocks on commit message, password, or anything else. Commands must complete without human interaction.
- It is explicitly **forbidden** to invoke interactive editors (nano, vim, etc.) during merge/commit/rebase. Always provide commit and merge messages via flags (`-m`, `--no-edit`, `GIT_MERGE_AUTOEDIT=no`, etc.) so git commands run fully automatically.