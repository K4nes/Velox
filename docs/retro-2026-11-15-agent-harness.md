# Retro: how the agent navigates Velox, where the docs lie, and how to trust the loop

Date: 2026-11-15. Scope: every agent session that touched this repository, plus the
repository's own pull-request history. Read-only on `src/`; two document fixes and one
directory cleanup applied, listed under Status.

## Method

106 session transcripts in 38 workspace folders under `~/.pi/agent/sessions`,
2026-10-18 to 2026-11-15. Parsed by the six scripts in `docs/retro/`; every number
below comes from them.

```bash
PYTHONUTF8=1 python docs/retro/analyze_sessions.py "C:\Users\User\.pi\agent\sessions" velox /tmp/a.json
PYTHONUTF8=1 python docs/retro/bash_profile.py   "C:\Users\User\.pi\agent\sessions" velox /tmp/b.json
PYTHONUTF8=1 python docs/retro/per_month.py      "C:\Users\User\.pi\agent\sessions" velox /tmp/c.json
PYTHONUTF8=1 python docs/retro/failures.py       "C:\Users\User\.pi\agent\sessions" velox
PYTHONUTF8=1 python docs/retro/trust2.py
PYTHONUTF8=1 python docs/retro/noverify.py
```

## The numbers

| Measure | Value |
| --- | --- |
| Session files / workspace folders | 106 / 38 |
| Tool calls | 11,703 |
| `bash` | 6,839 (58%) |
| `read` / `edit` / `write` | 1,478 / 649 / 371 |
| `ffgrep` / `fffind` | 64 / 1 |
| `bash` calls prefixed `cd … &&` | 6,453 (94.4%) |
| … their cost | 389,606 chars, about 97,000 tokens; 89.1% repeat the previous call's path |
| `bash` used to read a file (`cat`, `sed -n`, `head`) | 2,319 |
| `bash` used for ad-hoc search (`rg`, `grep`) | 1,617 |
| Tool errors | bash 613, read 220, edit 43 |
| Sessions hitting "path not found" | 61 of 106 |
| Sessions hitting missing `node_modules` | 13 |
| Calls before the first `edit` | median 43, p75 56, p90 88, max 162 (n=79) |
| `RULES.md` read in full | 84 times |
| Merged PRs / closed unmerged | 95 / 5 |
| `src/`-touching commits that also touch tests | 12 of 83 (14%) |

---

## What is still open

### A2. The instructions disagree about how to find a file

`bash` is 58% of all calls; inside it, 2,319 calls open files and 1,617 grep. `ffgrep` ran
64 times and `fffind` once.

Three layers contradict each other:

- Harness rules block: "Use bash for file operations like ls, rg, find."
- `~/.pi/agent/AGENTS.md:65`: "Find files with `fffind`, and search file contents with
  `ffgrep`. Use `bash` for what they cannot do."
- `/AGENTS.md` § Search: the same as the line above.

An agent reading all three takes the loosest one. Fix: delete the first line, state the
order once (`ffgrep`/`fffind` to locate, `read`/`read_symbol` to read, `bash` to run).

### A4. Two names for one page, and one 1,331-line module

Six pages have both an entry file and a folder: `src/pages/bulk-sell.tsx` and
`src/pages/bulk-sell/`, and the same for `portfolio`, `instant-sell`, `transfer`, `swap`,
`settings`. `src/lib/opensea/index.ts` is 1,331 lines; `use-mint-tasks.ts` is 1,042.

Fix: state the convention in `AGENTS.md` ("`<page>.tsx` is the route entry and holds no
logic"), and split the OpenSea client by endpoint family.

### A5. Rules are read whole, 84 times

`RULES.md` is 317 lines with no table of contents. Fix: a TOC, one `##` per rule family, and
"read the section you need, not the file".

### B1. Research documents vanish with the worktree, by design

`docs/` is intentionally untracked: research scratch. That is a valid choice. The cost is
real: 14 documents referenced 300+ times across sessions no longer exist, including
`docs/tauri-release-research.md` (76 reads) and `docs/doc-drift-audit.md` (24).

No rule needed. What changes is where a durable decision is written: `AGENTS.md`,
`RULES.md`, `CHANGELOG.md` or the PR body, at the moment it is made.

### B3. The doc-ownership guardrails exist and were never applied

`.github/PULL_REQUEST_TEMPLATE.md` is present in the main worktree and **untracked**, so no
PR has ever used it. It is the template from closed PR #71. It opens with:

> Read `AGENTS.md` § Doc ownership.

`grep -n "Doc ownership" AGENTS.md` exits 1 — the section does not exist. A contributor who
follows the template is sent to a missing section.

Fix: either add the section or drop the reference, then commit the template. `GLOSSARY.md`
and `skills-lock.json` are untracked in the same worktree, and a stray
`t3-887729d4-18a1d8dd612fdf09/` directory sits inside it — worth a look before either is
committed.

### C1–C5. The loop runs; it cannot see the promise

- Of 37 sessions that changed 3+ source files, 35 ran a check after their last edit and 1
  ran none. The 20 sessions that edited without any check are all doc, report or `.pi/tmp`
  work. The gate is not skipped; it is shallow — always the same four commands.
- PR #113 added 1,553 lines, including 142 lines of e2e tests, and went green with the
  wrong endpoint. PR #117 fixed it 11 hours later and had to rewrite the fixture and the
  mock, because both came from the same wrong assumption.
- 12 of 83 `src`-touching commits carry a test change.
- #106 and #107 apply one shell fix twice, 20 minutes apart; the second rewrites 316 lines
  of `portfolio.tsx`. #2/#5, #3/#4, #17/#18, #108/#109 are the same change opened twice.
- A bug fix never starts red. #117's fix arrived with a suite that had never failed for the
  reported behaviour.

---

## Feasibility of the four gates — measured, not assumed

Run on 2026-11-15 in the main worktree (`C:/Users/User/Workspace/velox`).

### `npm run verify` — doable, but only after `npm ci`

| Step | Command | Result |
| --- | --- | --- |
| stale install | `npx tsc -b --force` | **exit 2**, 8 errors: `@tauri-apps/api`, `plugin-updater`, `plugin-process`, `plugin-clipboard-manager` missing |
| stale install | `npm run test:e2e` | **exit 1**, 13 files failed / 41 tests failed, 238 s — `GET /src/lib/clipboard/clipboard.ts 500` |
| fix | `npm ci --no-audit --no-fund` | exit 0, 25 s, 501 packages |
| type check | `npx tsc -b --force` | exit 0 |
| build | `npm run build` | exit 0, 7 s |
| lint | `npm run lint` | exit 0, 1 s (warnings only) |
| script tests | `npm run test:release` | 29 pass, 0 fail, 1 s |
| browser suite | `npm run test:e2e` | 14 files / 42 tests pass, 62 s |

So `"verify": "npm run build && npm run lint && npm run test:release && npm run test:e2e"`
costs about 71 s when the install is current, and fails loudly for the wrong reason when it
is not. Two consequences: the script needs a precondition line in `AGENTS.md` ("stale
install → `npm ci` first"), and worktrees need their own install.

### Gate 0 — red first

A rule, nothing to build. It failed once: #117 landed a fix with no failing test. The place
to state it is `COMMIT.md` (`Test: <path> (red before the fix)` or `No test: <reason>`),
because that is where the commit body is already governed.

### Gate 1 — one route table: doable, but it changes a convention

A probe test importing app code both ways passed in 4 s:

```text
tests/contract/_probe.e2e.ts
  ✓ probe: a test file resolves app code by alias and by relative path
  Test Files 1 passed, Tests 1 passed
```

Two facts that shaped the plan and were wrong in the first draft:

- `escapeRegExp` is a **local** function in `tests/support/opensea.ts:24`, not exported.
- **No test imports from `src/` today** (`grep` over `tests/` finds none). Sharing
  `src/lib/opensea/routes.ts` with the mocked lane therefore crosses a deliberate boundary.
  It is possible; it is a convention change, not a free win.

### Gate 2 — a recorded response: doable, and the real shape confirms the bug

Fetched the live endpoint with the repo's own key (`E2E_OPEN_SEA_KEY` in
`.env.e2e.local`) and the portfolio slug:

```text
GET /api/v2/listings/collection/{slug}/all?limit=2   → 200
top-level keys: ['listings', 'next']
listing keys:   asset, chain, order_created_at, order_hash, price, price_per_item,
                protocol_address, protocol_data, remaining_quantity, status, type
```

No `orders`, no `current_price`, no `maker`, no `expiration_time`. The parser reads several
of those names through fallbacks — which is exactly why #113 was green: the fixture
invented a body the endpoint never returns.

Needed for the recorder: a browser User-Agent. A plain `urllib` request was refused with
Cloudflare `403 error 1010`; the same request with a Chrome UA returned 200.

Also needed: `export` on `toActiveListing` (`src/lib/opensea/index.ts:891`) — the plan's
":895" was wrong.

### Gate 3 — the live lane: runs right now, in 8 s

```text
npx e2e run --config e2e.live.config.ts tests/portfolio/live/scan.e2e.ts
  ✓ the configured wallet scans the collection into the portfolio   4.30s
  Test Files 1 passed, Tests 1 passed
```

Read-only: it scans, it does not list or sell. The `E2E_*` values exist, so a PR that touches
`src/lib/opensea/` or `src/lib/chain/` can run the affected folder before merge. CI cannot —
it has no secrets.

---

## Status

| # | Item | State | How it is settled |
| --- | --- | --- | --- |
| 1 | Runner count at `AGENTS.md:44` | **done** | the sentence names three runners |
| 2 | Two stale roots (`new-velox`, `Documents/workspace/velox`) | **done** | `ls` finds neither; the one unpushed file is at `docs/implicit-state-machines.tsv` |
| 3 | `cd` guidance in `~/.pi/agent/AGENTS.md:74` | **done** | the line teaches `cwd` and names the failure mode |
| 4 | PR template cited a missing `AGENTS.md` § Doc ownership | open | the file is fixed but untracked; the block now stands alone |
| 5 | "bash for file operations" line | open | `cd` share and `bash`-as-editor counts in the next retro |
| 6 | `npm run verify` + `npm ci` precondition | open, feasible | 71 s measured; 7 s + 1 s + 1 s + 62 s |
| 7 | `COMMIT.md`: `Test:` / `No test:` line | open | next commit body carries it |
| 8 | `AGENTS.md`: live lane on upstream-touching PRs | open, feasible | the 8 s run above |
| 9 | `src/lib/opensea/routes.ts` shared with the mocked lane | open, feasible | probe passes; crosses the "no src imports in tests" convention |
| 10 | `tests/contract/*.json` recordings + parser test | open, feasible | real 200 shows `listings`/`next`; recorder needs a browser UA |
| 11 | TOC in `RULES.md` | open | full-read count falls |
| 12 | Page entry/folder convention in `AGENTS.md` | open | six collisions named in one line |
| 13 | Worktree setup runs `npm ci` | open | new worktree has `node_modules` without a probe |
| 14 | `scripts/harness-stats.mjs` | open | next retro's numbers come from it |

## Limits

- Wall-clock duration is not used as a latency measure: sessions span days with idle gaps.
  Call counts are the proxy.
- Verdict parsing is exact only when output carries `error TS`, `exit=N`, or a test summary.
  23 of 37 code sessions fell back to "unknown" — no verdict is not a pass.
- The 14 deleted documents were checked by filename under `C:/Users/User/Workspace` and
  `C:/Users/User/Documents/workspace`. A copy elsewhere would not have been found.
- Gate 2's recording is one collection at one moment. It catches a wrong envelope and wrong
  field names; it does not prove every response variant.
