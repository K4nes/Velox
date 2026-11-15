"""Scan pi session transcripts for a repo and report navigation friction.

Usage: python analyze_sessions.py <sessions_root> <match_substring> <out.json>
"""
import json
import os
import re
import sys
from collections import Counter, defaultdict

root = sys.argv[1]
match = sys.argv[2].lower()
out_path = sys.argv[3]

skipped_dirs = {".git", "node_modules", "dist", ".worktrees"}

sessions = []
for d in sorted(os.listdir(root)):
    dpath = os.path.join(root, d)
    if not os.path.isdir(dpath):
        continue
    if match not in d.lower():
        continue
    files = [f for f in os.listdir(dpath) if f.endswith(".jsonl")]
    for f in files:
        sessions.append(os.path.join(dpath, f))

print(f"{len(sessions)} session files", file=sys.stderr)

ERR_RE = re.compile(
    r"(Error:|error:|ENOENT|No such file|not found|Command failed|exit code [1-9]|"
    r"EPERM|EACCES|Traceback|Cannot find module)", re.I)

records = []
agg = {
    "tool_counts": Counter(),
    "error_tools": Counter(),
    "empty_grep": Counter(),
    "docs_read": Counter(),
    "bash_errors": Counter(),
    "notfound_paths": Counter(),
}
phrases = Counter()
phrase_hits = []

PHRASES = [
    "out of date", "outdated", "stale", "no longer", "doesn't exist", "does not exist",
    "not what the doc", "agents.md says", "rules.md says", "actually it", "instead it",
    "the doc", "contradict", "wrong", "deprecated",
]

for path in sessions:
    rec = {
        "dir": os.path.basename(os.path.dirname(path)),
        "file": os.path.basename(path),
        "cwd": None,
        "start": None,
        "end": None,
        "user_turns": 0,
        "tool_calls": 0,
        "tool_errors": 0,
        "calls_before_first_edit": None,
        "calls_before_first_read": None,
        "tools": Counter(),
        "error_tools": Counter(),
        "empty_greps": [],
        "notfound": [],
        "bash_failures": [],
        "docs": Counter(),
        "files_read": Counter(),
        "repeat_calls": [],
        "max_tool_gap_s": 0,
        "total_tool_s": 0,
        "first_user_prompt": "",
        "duration_s": None,
    }
    call_seq = []
    call_index = 0
    prev_ts = None
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except Exception:
                    continue
                t = e.get("type")
                ts = e.get("timestamp")
                if t == "session":
                    rec["cwd"] = e.get("cwd")
                    rec["start"] = ts
                    prev_ts = ts
                elif ts:
                    rec["end"] = ts
                if t != "message":
                    continue
                m = e.get("message") or {}
                role = m.get("role")
                content = m.get("content")
                blocks = content if isinstance(content, list) else []
                if role == "user":
                    rec["user_turns"] += 1
                    if not rec["first_user_prompt"]:
                        txt = " ".join(
                            b.get("text", "") for b in blocks if isinstance(b, dict))
                        rec["first_user_prompt"] = txt[:400]
                if role == "assistant":
                    for b in blocks:
                        if not isinstance(b, dict):
                            continue
                        if b.get("type") in ("toolCall", "tool_use", "tool-call"):
                            name = b.get("name") or b.get("toolName") or "?"
                            args = b.get("arguments") or b.get("input") or {}
                            call_index += 1
                            rec["tool_calls"] += 1
                            rec["tools"][name] += 1
                            agg["tool_counts"][name] += 1
                            sig = name + " " + json.dumps(args, sort_keys=True)[:300]
                            call_seq.append(sig)
                            if name == "read" and rec["calls_before_first_read"] is None:
                                rec["calls_before_first_read"] = call_index
                            if name == "read":
                                p = args.get("path", "")
                                rec["files_read"][p] += 1
                                low = p.lower()
                                for doc in ("agents.md", "rules.md", "commit.md", "review.md", "readme.md", "changelog.md"):
                                    if doc in low:
                                        rec["docs"][doc] += 1
                                        agg["docs_read"][doc] += 1
                                if "docs/" in low:
                                    rec["docs"][p] += 1
                                    agg["docs_read"][p] += 1
                            if name in ("edit", "write") and rec["calls_before_first_edit"] is None:
                                rec["calls_before_first_edit"] = call_index
                            if name in ("bash", "ffgrep", "fffind"):
                                cmd = str(args.get("command") or args.get("pattern") or "")
                                if re.search(r"(grep|rg|find|ls|dir )", cmd):
                                    pass
                elif role in ("toolResult", "tool_result", "tool"):
                    name = m.get("toolName") or m.get("name") or "?"
                    txt = ""
                    if isinstance(content, list):
                        txt = " ".join(
                            str(b.get("text", "")) if isinstance(b, dict) else str(b)
                            for b in content)
                    elif isinstance(content, str):
                        txt = content
                    is_err = bool(m.get("isError")) or bool(ERR_RE.search(txt[:2000]))
                    if is_err:
                        rec["tool_errors"] += 1
                        rec["error_tools"][name] += 1
                        agg["error_tools"][name] += 1
                        notfound = re.findall(
                            r"(?:No such file or directory|ENOENT|cannot find the path|"
                            r"File does not exist|not found)[^\\n]{0,120}", txt[:1500])
                        for nf in notfound[:2]:
                            rec["notfound"].append(nf[:160])
                            agg["notfound_paths"][nf[:120]] += 1
                        if name == "bash":
                            rec["bash_failures"].append(txt[:200].replace("\n", " "))
                            agg["bash_errors"][txt[:140].replace("\n", " ")] += 1
                    else:
                        low = txt.lower()
                        if name in ("ffgrep", "fffind") and (
                                "no matches" in low or "0 matches" in low or "no results" in low
                                or not txt.strip()):
                            rec["empty_greps"].append(txt[:100])
                            agg["empty_grep"][name] += 1
                        for ph in PHRASES:
                            if ph in low:
                                phrases[ph] += 1
                                if len(phrase_hits) < 400:
                                    phrase_hits.append({"file": rec["file"], "phrase": ph,
                                                        "ctx": txt[max(0, low.find(ph) - 160):low.find(ph) + 200].replace("\n", " ")})
                                break
                    if ts and prev_ts:
                        pass
    except Exception as ex:
        rec["parse_error"] = str(ex)

    # repeated identical calls
    seen = Counter(call_seq)
    rec["repeat_calls"] = [(k[:160], v) for k, v in seen.items() if v >= 3][:10]
    rec["tools"] = dict(rec["tools"])
    rec["error_tools"] = dict(rec["error_tools"])
    rec["docs"] = dict(rec["docs"])
    rec["files_read"] = dict(rec["files_read"].most_common(12))
    rec["empty_greps"] = rec["empty_greps"][:10]
    rec["notfound"] = rec["notfound"][:10]
    rec["bash_failures"] = rec["bash_failures"][:8]
    records.append(rec)

payload = {
    "records": records,
    "agg": {
        "tool_counts": dict(agg["tool_counts"].most_common()),
        "error_tools": dict(agg["error_tools"].most_common()),
        "empty_grep": dict(agg["empty_grep"]),
        "docs_read": dict(agg["docs_read"].most_common(40)),
        "bash_errors": dict(agg["bash_errors"].most_common(40)),
        "notfound_paths": dict(agg["notfound_paths"].most_common(40)),
        "phrases": dict(phrases.most_common()),
    },
    "phrase_hits": phrase_hits,
}
os.makedirs(os.path.dirname(out_path), exist_ok=True)
with open(out_path, "w", encoding="utf-8") as fh:
    json.dump(payload, fh, indent=1)
print("wrote", out_path, file=sys.stderr)
