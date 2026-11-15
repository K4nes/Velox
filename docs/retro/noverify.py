"""Sessions that edited files but ran no verification: what did they touch?"""
import json
import os
import re

root = r"C:\Users\User\.pi\agent\sessions"
VERIFY = re.compile(
    r"(tsc -b|npx tsc|npm run build|npm run lint|npx oxlint|npm run test:e2e|npx e2e run"
    r"|npm run test:release|cargo (test|clippy)|node scripts/check-|desktop-check)")

for d in sorted(os.listdir(root)):
    dp = os.path.join(root, d)
    if not os.path.isdir(dp) or "velox" not in d.lower():
        continue
    for f in os.listdir(dp):
        if not f.endswith(".jsonl"):
            continue
        paths = []
        hv = False
        for line in open(os.path.join(dp, f), encoding="utf-8", errors="replace"):
            if not line.strip():
                continue
            try:
                e = json.loads(line)
            except Exception:
                continue
            if e.get("type") != "message":
                continue
            m = e.get("message") or {}
            if m.get("role") != "assistant":
                continue
            for b in m.get("content") or []:
                if not isinstance(b, dict) or b.get("type") not in ("toolCall", "tool_use", "tool-call"):
                    continue
                a = b.get("arguments") or {}
                if b.get("name") in ("edit", "write"):
                    paths.append(str(a.get("path", ""))[-48:])
                if b.get("name") == "bash" and VERIFY.search(str(a.get("command", ""))):
                    hv = True
        if paths and not hv:
            print(f"{d[-34:]:34s} edits={len(paths):3d}  {', '.join(paths[:3])}")
