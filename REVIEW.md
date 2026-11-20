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
