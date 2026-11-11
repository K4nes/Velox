## Commit Message Rules

All commit messages MUST follow Conventional Commits.

### Format

`<type>(<scope>): <description>`

The scope is optional.

### Allowed Types

- `feat`: Introduce a new feature.
- `fix`: Fix a bug.
- `refactor`: Restructure code without intentionally changing behavior.
- `perf`: Improve performance.
- `test`: Add or update tests without changing production behavior.
- `docs`: Change documentation only.
- `style`: Make non-functional code formatting changes.
- `build`: Change build configuration or dependencies.
- `ci`: Change CI/CD configuration.
- `chore`: Perform maintenance that does not fit another type.

There is no `release` type. A release commit moves the changelog and bumps the version, so
it is a `chore` with a `release` scope: `chore(release): add the changelog and bump the
version to 0.1.0`.

Merge commits are exempt from this format. `Merge branch 'x'` and `Merge pull request #N
from user/branch` are written by git and stay as generated. Do not edit them to fit.

### Writing Rules

1. Write commit messages in English.
2. Use lowercase for the type, scope, and description.
3. Use an imperative, concise description of the actual change.
4. Do not end the description with a period.
5. Keep the subject line at 72 characters or fewer.
6. Use a scope only when it accurately identifies the affected module.
7. Do not use vague descriptions such as "update code", "fix bug", or "misc changes".
8. Do not invent implementation details, test results, or behavioral improvements.

### Evidence Requirements

1. Inspect the staged diff before generating the commit message.
2. Use `git diff --cached` as the primary source of truth for the changes being committed.
3. Use the relevant surrounding code when necessary to understand the change.
4. Do not infer the change solely from the user's request, branch name, or previous agent messages.
5. Select the type based on the actual change, not the intended task.
6. If changes are unrelated, recommend separate commits when practical.
7. If the change is ambiguous, choose a conservative description or ask for clarification.

### Breaking Changes

For intentional breaking changes, use the `!` marker and explain the impact in the commit body.

Example:

`feat(api)!: remove the legacy authentication endpoint`

### Final Check

Before presenting a commit message, verify that:

- The type matches the actual change.
- The scope is accurate, if present.
- The description is specific and concise.
- Every claim is supported by the diff.
- The message does not claim tests passed unless they were actually run and passed.

Prefer a single-line subject unless additional context is necessary.
