"""Per-month view: how agents spent tool calls, and the cd-prefix share over time."""
import json
import os
import re
import sys
from collections import Counter, defaultdict

root = sys.argv[1]
match = sys.argv[2].lower()
out = sys.argv[3]

sessions = []
for d in sorted(os.listdir(root)):
    dp = os.path.join(root, d)
    if os.path.isdir(dp) and match in d.lower():
        for f in os.listdir(dp):
            if f.endswith(".jsonl"):
                sessions.append(os.path.join(dp, f))

READ_BASH = re.compile(r"\b(cat|Get-Content|sed -n|head -|tail -)\b", re.I)
GREP_BASH = re.compile(r"\b(rg|grep|Select-String|findstr)\b", re.I)
FIND_BASH = re.compile(r"\b(find|ls|Get-ChildItem|tree|dir)\b", re.I)

per_month = defaultdict(lambda: Counter())
per_session = []

for p in sessions:
    month = os.path.basename(p)[:7]
    c = per_month[month]
    calls = 0
    first_edit = None
    info = {"file": os.path.basename(p)[:32], "dir": os.path.basename(os.path.dirname(p))[:40], "month": month}
    bash = read_bash = grep_bash = find_bash = cd = 0
    hits = 0
    misses = 0
    last_calls = 0
    try:
        with open(p, encoding="utf-8", errors="replace") as fh:
            lines = fh.read().splitlines()
    except OSError as ex:
        print("cannot read", p, ex, file=sys.stderr)
        lines = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            print("skip malformed line in", p, file=sys.stderr)
            continue
        if e.get("type") != "message":
            continue
        m = e.get("message") or {}
        role = m.get("role")
        content = m.get("content")
        blocks = list(content) if isinstance(content, list) else []
        if role == "assistant":
                for b in blocks:
                    if not isinstance(b, dict) or b.get("type") not in ("toolCall", "tool_use", "tool-call"):
                        continue
                    calls += 1
                    name = b.get("name") or "?"
                    args = b.get("arguments") or {}
                    if name in ("edit", "write") and first_edit is None:
                        first_edit = calls
                    if name == "bash":
                        bash += 1
                        cmd = str(args.get("command", ""))
                        if re.match(r"^\s*cd\s", cmd):
                            cd += 1
                        if READ_BASH.search(cmd):
                            read_bash += 1
                        if GREP_BASH.search(cmd):
                            grep_bash += 1
                        if FIND_BASH.search(cmd):
                            find_bash += 1
        elif role in ("toolResult", "tool_result"):
            txt = " ".join(str(b.get("text", "")) for b in blocks if isinstance(b, dict))
            low = txt.lower()
            if "no matches" in low or "no results" in low or "no files found" in low or not low.strip():
                misses += 1
            else:
                hits += 1
    last_calls = calls
    c["sessions"] += 1
    c["calls"] += calls
    c["bash"] += bash
    c["next_call_cd"] += cd
    c["bash_read"] += read_bash
    c["bash_grep"] += grep_bash
    c["bash_find"] += find_bash
    c["miss"] += misses
    c["hit"] += hits
    info.update(calls=calls, first_edit=first_edit, bash=bash, cd=cd,
                bash_read=read_bash, bash_grep=grep_bash, bash_find=find_bash)
    per_session.append(info)

print("month     sess calls  bash  cd%%  bashRead bashGrep bashFind  miss%%", file=sys.stderr)
rows = []
for month in sorted(per_month):
    c = per_month[month]
    cd_share = 100 * c["next_call_cd"] / c["bash"] if c["bash"] else 0
    miss = 100 * c["miss"] / (c["miss"] + c["hit"]) if (c["miss"] + c["hit"]) else 0
    line = (f"{month}  {c['sessions']:4d} {c['calls']:6d} {c['bash']:5d} {cd_share:5.1f} "
            f"{c['bash_read']:8d} {c['bash_grep']:8d} {c['bash_find']:8d} {miss:6.1f}")
    print(line, file=sys.stderr)
    rows.append(line)

fe = [s["first_edit"] for s in per_session if s["first_edit"]]
fe.sort()
n = len(fe)
p75 = fe[min(n - 1, round(n * 0.75))]
p90 = fe[min(n - 1, round(n * 0.9))]
print(f"calls-before-first-edit: n={n} median={fe[n // 2]} p75={p75} p90={p90} max={fe[-1]}", file=sys.stderr)
with open(out, "w", encoding="utf-8") as fh:
    json.dump({"months": rows, "sessions": per_session,
               "first_edit": {"median": fe[n // 2], "p75": p75, "p90": p90}},
              fh, indent=1)
