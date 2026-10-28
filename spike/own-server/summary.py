"""Collects every variant's result.json (variant.sh) into one Markdown report: the host, a table of variant to health
and self-check, then each variant's evidence. Usage: python3 summary.py <dir holding spike-*/result.json>."""
import json
import os
import sys

ORDER = ["a", "b", "c", "bc", "bcs", "d", "ds", "dn", "dn29", "dn2204", "d4", "cs", "dnh", "dnt", "dsx", "e", "ec", "ebc", "ebcs", "eds"]

root = sys.argv[1]
results = {}
for dirpath, _dirs, files in os.walk(root):
    if "result.json" in files:
        with open(os.path.join(dirpath, "result.json"), encoding="utf-8") as handle:
            data = json.load(handle)
        results[data["variant"]] = (data, dirpath)


def flags(data):
    shown = []
    for item in data["opts"]:
        item = item.replace("seccomp=seccomp-omb-home.json", "seccomp=omb-home.json")
        if shown and shown[-1] in ("--security-opt", "--cap-add", "--cap-drop", "--oom-score-adj"):
            shown[-1] = f"{shown[-1]} {item}"
        else:
            shown.append(item)
    return " ".join(s.replace("--security-opt ", "") for s in shown) or "(Docker defaults)"


def score(data):
    box = data.get("byHand") or {}
    if box.get("box") and box.get("box") != "bwrap":
        return f"box off ({box.get('reason')})"
    if box.get("total"):
        return f"{box.get('passed')}/{box.get('total')}"
    if box.get("error"):
        return f"error: {box['error'][:60]}"
    return "n/a"


def signed(data):
    report = data.get("signedBox") or {}
    if report.get("status") != 200:
        return "n/a"
    if report.get("box") != "bwrap":
        return f"box {report.get('box')} ({report.get('reason')})"
    return str(report.get("checks"))


def first_failure(data):
    for line in data.get("probes", []):
        parts = line.split("\t")
        if len(parts) >= 3 and parts[1] != "rc=0" and parts[0] not in ("overlay-in-userns", "sysfs-in-userns"):
            return f"{parts[0]}: {parts[2][:110]}"
    return ""


lines = []
any_result = next(iter(results.values()), None)
if any_result:
    host_file = os.path.join(any_result[1], "host-before.txt")
    if os.path.exists(host_file):
        lines += ["## Host (as found, before any variant's step)", "", "```", open(host_file, encoding="utf-8").read().strip(), "```", ""]

lines += [
    "## Matrix",
    "",
    "| variant | host userns restricted | container settings | health (s) | boot self-check (signed) | by-hand self-check | failed checks | hidepid | first failing bwrap probe |",
    "|---|---|---|---|---|---|---|---|---|",
]
for variant in ORDER + sorted(set(results) - set(ORDER)):
    if variant not in results:
        lines.append(f"| {variant} | | | (no result) | | | | | |")
        continue
    data, _ = results[variant]
    hard = ((data.get("signedBox") or {}).get("hardening") or {})
    failed = ", ".join((data.get("byHand") or {}).get("failed") or []) or ""
    lines.append(
        f"| {variant} | {data['hostUsernsRestricted']} | `{flags(data)}` | {data['health'] if data['healthy'] else 'NO: ' + data['health']} | "
        f"{signed(data)} | {score(data)} | {failed} | {hard.get('hidepid', 'n/a')} | {first_failure(data)} |")
lines.append("")

for variant in ORDER + sorted(set(results) - set(ORDER)):
    if variant not in results:
        continue
    data, _ = results[variant]
    lines += [f"### {variant}: `{flags(data)}`", "", "```"]
    lines += [f"host step: {line}" for line in data.get("hostStep", [])]
    lines += [f"inspect: {data.get('inspect', '')}"]
    lines += [f"health: {data['health']}"]
    for key in ("signedBox", "signedHealth", "pairing", "byHand", "mutations", "lockout"):
        if data.get(key) is not None:
            lines.append(f"{key}: {json.dumps(data[key])[:900]}")
    for key in ("probes", "security", "paths", "oom", "restarts", "bootLog", "apparmorDenials"):
        for line in data.get(key, []):
            lines.append(f"{key}: {line[:400]}")
    lines += ["```", ""]

print("\n".join(lines))
