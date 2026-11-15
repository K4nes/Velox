# Pull request

## What this changes

<!-- One paragraph. Say what the change does and why. -->

## Documentation

A change updates the documents it makes false, in the same pull request.

- [ ] No sentence in `AGENTS.md`, `RULES.md`, `README.md` or `CHANGELOG.md` now contradicts
      this change.
- [ ] I did not edit a `RULES.md` rule to match a defect. A code defect is fixed in code.
- [ ] Every document, path and command this change names exists in this commit.
- [ ] `CHANGELOG.md` § Unreleased has an entry, when a user can see the change.

## Verification

- [ ] `npm run build` passes. <!-- tsc -b && vite build -->
- [ ] `npm run lint` passes.
- [ ] `npm run test:e2e` passes, when the change touches a flow.
- [ ] I list below every check I did not run.

Checks not run:

<!-- Omit them from the pull request if you ran all four. -->

## Layout

Delete this section when the pull request does not change a page layout.

- [ ] I attached a screenshot at 1024px and wider.
- [ ] I checked `RULES.md` for the page shell, panel headers, tables and rails.

## Commit

- [ ] Every commit follows `COMMIT.md`.
- [ ] No commit message claims a check that did not run.
