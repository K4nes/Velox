"""Count recurring failure signatures across all repo sessions."""
import json
import os
import re
import sys
from collections import Counter

root = sys.argv[1]
match = sys.argv[2].lower()

SIGS = {
    "no_node_modules": re.compile(r"(ENOENT[^\n]*node_modules|node_modules[^\n]*(not found|No such)|Cannot find module 'vite'|vite: not found|'tsc' is not recognized)", re.I),
    "npm_install_needed": re.compile(r"npm install", re.I),
    "path_not_found": re.compile(r"(No such file or directory|ENOENT|cannot find the path)", re.I),
    "oldtext_mismatch": re.compile(r"(edits\[\d+\]\.oldText|oldText.{0,80}not found|String to replace not found)", re.I),
    "cmd_not_found": re.compile(r"(command not found|is not recognized as (an internal|the name))", re.I),
    "timeout": re.compile(r"(timed out|Timeout|ETIMEDOUT)", re.I),
    "git_conflict": re.compile(r"(CONFLICT \(|Merge conflict|Needed a single revision|fatal: )", re.I),
    "tsc_error": re.compile(r"error TS\d+", re.I),
    "vite_port": re.compile(r"(EADDRINUSE|Port \d+ is already in use)", re.I),
    "empty_search": re.compile(r"(No matches found|No files matched|no results|0 matches|No files found)", re.I),
    "permission": re.compile(r"(EPERM|EACCES|Permission denied|Access is denied)", re.I),
    "rust_build": re.compile(r"(could not compile|error\[E\d+\]|linking with `cc` failed)", re.I),
    "codec": re.compile(r"(UnicodeEncodeError|charmap|codec can't encode)", re.I),
}

counts = Counter()
examples = {}
sessions_hit = Counter()

files = []
for d in sorted(os.listdir(root)):
    dp = os.path.join(root, d)
    if os.path.isdir(dp) and match in d.lower():
        for f in os.listdir(dp):
            if f.endswith(".jsonl"):
                files.append(os.path.join(dp, f))

for p in files:
    seen_here = set()
    try:
        fh = open(p, encoding="utf-8", errors="replace")
        for line in fh:
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
            if m.get("role") not in ("toolResult", "tool_result", "tool"):
                continue
            blocks = m.get("content")
            txt = " ".join(str(b.get("text", "")) for b in blocks if isinstance(b, dict)) if isinstance(blocks, list) else str(blocks)
            for name, rx in SIGS.items():
                mt = rx.search(txt)
                if not mt:
                    continue
                counts[name] += 1
                if name not in seen_here:
                    seen_here.add(name)
                    sessions_hit[name] += 1
                if name not in examples:
                    i = mt.start()
                    examples[name] = txt[max(0, i - 120):i + 220].replace("\n", " | ")[:330]
    except Exception:
        pass

print(f"sessions={len(files)}")
print(f"{'signature':22s} {'hits':>6s} {'sessions':>9s}")
for name, n in counts.most_common():
    print(f"{name:22s} {n:6d} {sessions_hit[name]:9d}")
print()
for name, _ in counts.most_common(6):
    print(f"## {name}\n   {examples[name]}")
