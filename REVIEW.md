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
