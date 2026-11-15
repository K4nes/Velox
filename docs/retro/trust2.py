"""Trust loop v2: only sessions that changed code, judged on unambiguous output."""
import json
import os
import re

root = r"C:\Users\User\.pi\agent\sessions"

VERIFY_CMD = re.compile(
    r"(tsc -b|npx tsc|npm run build|npm run lint|npx oxlint|npm run test:e2e|npx e2e run"
    r"|npm run test:release|cargo test|cargo clippy)")
RED = re.compile(r"(error TS\d+:|Command exited with code [1-9]|^\s*exit=[1-9]|Tests\s+\d+ failed|Test Files\s+\d+ failed|FAIL\s)")
GREEN = re.compile(r"(exit=0|EXIT=0|Test Files\s+\d+ passed|Tests\s+\d+ passed|test result: ok|Found 0 (errors|warnings))")

files = []
for d in sorted(os.listdir(root)):
    dp = os.path.join(root, d)
    if os.path.isdir(dp) and "velox" in d.lower():
        for f in os.listdir(dp):
            if f.endswith(".jsonl"):
                files.append(os.path.join(dp, f))

rows = []
for p in files:
    seq = []  # ("call", idx, name, args) / ("res", idx, text)
    idx = 0
    for line in open(p, encoding="utf-8", errors="replace"):
        line = line.strip()
        if not line:
            continue
        try:
            e = json.loads(line)
        except Exception:
            continue
        if e.get("type") != "message":
            continue
        m = e.get("message") or {}
        role = m.get("role")
        blocks = m.get("content") if isinstance(m.get("content"), list) else []
        if role == "assistant":
            for b in blocks:
                if isinstance(b, dict) and b.get("type") in ("toolCall", "tool_use", "tool-call"):
                    idx += 1
                    seq.append(("call", idx, b.get("name"), b.get("arguments") or {}))
        elif role in ("toolResult", "tool_result", "tool"):
            txt = " ".join(str(b.get("text", "")) for b in blocks if isinstance(b, dict)) if isinstance(blocks, list) else str(blocks)
            seq.append(("res", idx, None, txt))

    edits = [s for s in seq if s[0] == "call" and s[2] in ("edit", "write")]
    src_edits = [s for s in edits if re.search(r"\.(tsx?|mjs|rs|css)$", str((s[3] or {}).get("path", "")))]
    checks = []
    for i, s in enumerate(seq):
        if s[0] != "call" or s[2] != "bash":
            continue
        cmd = str((s[3] or {}).get("command", ""))
        if not VERIFY_CMD.search(cmd):
            continue
        out = ""
        for s2 in seq[i + 1:]:
            if s2[0] == "res":
                out = s2[3]
                if len(out.strip()) > 8:
                    break
        tail = out[-1500:]
        verdict = "red" if RED.search(tail) else ("green" if GREEN.search(tail) else "unknown")
        checks.append((s[1], cmd, verdict, tail))

    if len(src_edits) < 3:
        continue
    last_edit = src_edits[-1][1]
    after = [c for c in checks if c[0] > last_edit]
    rows.append({
        "dir": os.path.basename(os.path.dirname(p))[-38:],
        "src_edits": len(src_edits),
        "checks": len(checks),
        "after_last_edit": len(after),
        "after_verdict": after[-1][2] if after else None,
        "last_verdict": checks[-1][2] if checks else None,
        "cmds": sorted({re.sub(r"^\s*cd\s+\S+\s*&&\s*", "", c[1])[:26] for c in checks})[:6],
    })

rows.sort(key=lambda r: r["src_edits"])
print(f"code-changing sessions: {len(rows)}")
n = len(rows)
print(f"no check after last edit: {sum(1 for r in rows if r['after_last_edit'] == 0)}/{n}")
print(f"ended with no checks at all: {sum(1 for r in rows if r['checks'] == 0)}/{n}")
print(f"last check after edits green: {sum(1 for r in rows if r['after_verdict'] == 'green')}")
print(f"last check after edits red: {sum(1 for r in rows if r['after_verdict'] == 'red')}")
print(f"last check after edits unknown: {sum(1 for r in rows if r['after_verdict'] == 'unknown')}")
print()
for r in rows:
    print(f"{r['src_edits']:3d} edits {r['checks']:3d} checks {r['after_last_edit']:2d} after "
          f"{str(r['after_verdict']):7s} | {r['dir'][:34]:34s} | {','.join(r['cmds'])[:60]}")
