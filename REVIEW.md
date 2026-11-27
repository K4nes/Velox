# AI Code Review Rules

## Objective

Identify actionable defects introduced by the current changeset.

## Scope
- Review changes against the explicitly specified base branch.
- Inspect every relevant changed code path.
- Read surrounding code and related callers, tests, and interfaces when necessary.
- Report pre-existing issues only when they materially affect the safety or correctness of the reviewed change.

## Review Priorities
1. Functional correctness and regressions
2. Security and authorization
3. Data integrity
4. Error handling and edge cases
5. Concurrency and asynchronous behavior
6. Performance issues with a concrete impact
7. Missing or inadequate tests for changed behavior

Feature and page behavior is proven by the E2E suite. Do not report a missing unit test
for a path the E2E suite covers. `npm run test:release` and `cargo test` cover release
tooling and the Tauri commands; they are infrastructure gates, not feature tests.

An upstream client counts as changed behaviour: a new or edited request path under
`src/lib/<provider>/` ships a recorded response in `tests/contract/` (written by
`node scripts/contract-record.mjs`) or a live-lane case for that path. The mocked lane
answers whatever path the client was written against, so a wrong one stays green in both.

## Settled decisions

A review round reads the branch's review notes or pull-request discussion for judgement
calls already settled. A settled judgement call is not re-reported without new evidence.
Record the finding, the disposition, and the reason wherever the branch already keeps
review notes. A documented-standard violation still gets reported; settled judgement
calls are the only thing this suppresses.

## Acceptance criteria and state lifelines

- Every acceptance-criterion bullet needs a code path and a test that proves it. A test
  asserting the opposite of a bullet is a finding, not a test to adjust.
- A new `WalletRun` field or `RunStatus` member must be traced through `rowsFromCheck`,
  `mergeCheckedRows`, the run reset, the abort path, and the receipt path. One path that
  does not handle it is a finding.

## Evidence for changed behavior

- A guard test tampers the value the guard trusts, not only a value outside the trusted
  set. A rogue operator with the real Seaport does not prove a response's own protocol
  address is trustworthy.
- A migration test seeds the pre-migration row and asserts the post-migration values.
  Empty or default rows do not exercise the rewrite that can lose a key or a row.
- A behavior-change test asserts the output that changed. An aggregate that already
  passes on the base branch does not prove a chart, label or state changed.
- A boundary relation is tested both ways: widening and narrowing a wallet set, adding
  and removing a token, old shape and new shape. One direction can be valid while the
  other regresses.

## Parallel PR slices

- In a stack of domain PRs, only the integration or release PR edits `CHANGELOG.md`.
  A slice that changes the same `### Fixed` block will conflict on the squash train,
  and the conflict resolution is not part of the change being reviewed.

## Live lanes

- A live case pins every input it asserts: quantity, list, chain and spender. A value read
  from the provider is compared with the value the run used, not assumed.
- A skip is not proof. A preflight that stops before the browser names the missing value or
  the short balance; a case that can pass while minting nothing is a finding.
- A live case reads the target's token standard before it asserts a balance, and refuses a
  standard it cannot read by name.
- A lane's env names live in `scripts/live-env.mjs`, and its npm script runs
  `scripts/check-live-env.mjs <lane>` before the browser.

## Finding Requirements
Every finding must:
- Identify a specific defect, not merely a possible improvement.
- Explain a plausible failure scenario.
- Describe the actual impact.
- Reference the smallest relevant changed code location.
- Include a suggested fix when practical.

Do not report an issue if it depends on unsupported assumptions.
Do not duplicate findings describing the same root cause.
Do not report style preferences as defects.
Do not invent requirements that are absent from the task or repository context.

## Severity
- P0: Critical system or security impact.
- P1: High-impact failure of core functionality.
- P2: Meaningful defect with limited scope or specific conditions.
- P3: Minor but demonstrable defect.

Use the lowest severity that accurately represents the impact.

## Constraints
- Read-only: never modify files or create commits.
- Do not automatically apply fixes.
- Do not claim tests passed unless they were actually executed.
- Clearly distinguish verified behavior from uncertain hypotheses.
- An empty findings list is acceptable when no actionable defects are found.

## Output
For each finding:
- Severity
- Title
- File and line
- Failure scenario
- Impact
- Suggested fix

Conclude with a brief summary of the review scope and any checks that were not performed.
