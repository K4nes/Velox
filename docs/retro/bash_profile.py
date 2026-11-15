"""Third pass: classify every bash command and first-action pattern per session."""
import json
import os
import re
import sys
from collections import Counter

root = sys.argv[1]
match = sys.argv[2].lower()
out_path = sys.argv[3]


def listdir(path):
    try:
        return os.listdir(path)
    except OSError:
        return []

CATS = [
    ("read_file", re.compile(r"\b(cat|Get-Content|type|sed -n|head -n|more)\b", re.I)),
    ("list_dir", re.compile(r"\b(ls|dir|Get-ChildItem|tree)\b", re.I)),
    ("search", re.compile(r"\b(rg|grep|Select-String|findstr|find)\b", re.I)),
    ("git", re.compile(r"\bgit\b", re.I)),
    ("test_build", re.compile(r"(npm run|npx |cargo |node scripts|vitest|pytest)", re.I)),
    ("gh", re.compile(r"\bgh \b|glab ", re.I)),
    ("powershell", re.compile(r"(Get-|Set-|New-Item|Remove-Item|Copy-Item)", re.I)),
]

sessions = []
for d in sorted(listdir(root)):
    dpath = os.path.join(root, d)
    if os.path.isdir(dpath) and match in d.lower():
        for f in listdir(dpath):
            if f.endswith(".jsonl"):
                sessions.append(os.path.join(dpath, f))

cats = Counter()
first_action = Counter()
agent_md_first = 0
sessions_first = []
cd_prefix = 0
total_bash = 0
pipe_ok = 0
long_cmds = []
samples = {k: [] for k, _ in CATS}

for path in sessions:
    first = None
    first_cmds = []
    calls = 0
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    print("skip malformed line in", path, file=sys.stderr)
                    continue
                if e.get("type") != "message":
                    continue
                m = e.get("message") or {}
                if m.get("role") != "assistant":
                    continue
                for b in m.get("content") or []:
                    if not isinstance(b, dict):
                        continue
                    if b.get("type") not in ("toolCall", "tool_use", "tool-call"):
                        continue
                    name = b.get("name") or "?"
                    args = b.get("arguments") or {}
                    calls += 1
                    if calls <= 3:
                        first_cmds.append((name, str(args.get("command") or args.get("pattern") or args.get("path") or "")[:160]))
                    if name == "bash":
                        total_bash += 1
                        cmd = str(args.get("command", ""))
                        if len(cmd) > 1200:
                            long_cmds.append(cmd[:160])
                        if re.match(r"^\s*cd\s", cmd):
                            cd_prefix += 1
                        for label, rx in CATS:
                            if rx.search(cmd):
                                cats[label] += 1
                                if len(samples[label]) < 6:
                                    samples[label].append(cmd[:150].replace("\n", " | "))
                                break
    except OSError as ex:
        print("cannot read", path, ex, file=sys.stderr)
    key = first_cmds[0][0] if first_cmds else "none"
    first_action[key] += 1
    if first_cmds and "AGENTS.md" in first_cmds[0][1]:
        agent_md_first += 1
    sessions_first.append({
        "dir": os.path.basename(os.path.dirname(path))[:46],
        "first3": first_cmds,
        "calls": calls,
    })

print(f"sessions={len(sessions)} bash={total_bash} cd_prefixed={cd_prefix}", file=sys.stderr)
payload = {
    "cats": dict(cats.most_common()),
    "first_action": dict(first_action.most_common()),
    "total_bash": total_bash,
    "cd_prefixed": cd_prefix,
    "agent_md_first": agent_md_first,
    "samples": samples,
    "sessions_first": sessions_first,
    "long_cmds": long_cmds[:30],
}
try:
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1)
except OSError as ex:
    print("cannot write", out_path, ex, file=sys.stderr)
    raise SystemExit(1) from ex
print("wrote", out_path, file=sys.stderr)
