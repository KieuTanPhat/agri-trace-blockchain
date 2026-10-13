#!/usr/bin/env python3
"""Server-side observation collector and window evaluator.

`collect` appends one sample per run to an append-only JSON Lines ledger; run it
every minute from a root-owned scheduler. `report` evaluates the trailing
observation window (since the last release/image change) against the production
acceptance bounds. The collector never mutates the application, reads no secrets
and records only scalar probe results.
"""
import argparse
import datetime
import json
import os
import re
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

SCHEMA = 1
NAME = re.compile(r"[a-z0-9][a-z0-9_.-]{0,39}")
SHA = re.compile(r"[0-9a-f]{40}")
MAX_TEXT = 120
UTC = datetime.timezone.utc


def require(condition, message):
    if not condition:
        raise ValueError(message)


def utc_now():
    return datetime.datetime.now(UTC)


def stamp(moment):
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_time(value):
    parsed = datetime.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    require(parsed.tzinfo is not None, "Timestamps need an explicit UTC offset")
    return parsed.astimezone(UTC)


def scalar(value):
    if isinstance(value, bool) or isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        return value[:MAX_TEXT]
    return None


def load_config(path):
    config = json.loads(Path(path).read_text(encoding="utf-8"))
    require(isinstance(config, dict), "The collector configuration must be a JSON object")
    names = set()

    def unique(item, kind):
        require(isinstance(item, dict), f"Each {kind} probe must be an object")
        name = item.get("name")
        require(isinstance(name, str) and NAME.fullmatch(name), f"Invalid {kind} probe name")
        require(name not in names, f"Duplicate probe name {name}")
        names.add(name)
        return name

    for item in config.get("http", []):
        unique(item, "http")
        parts = urlsplit(item.get("url", ""))
        require(parts.scheme in ("http", "https") and parts.hostname and not parts.username and not parts.password,
                "HTTP probes need an http(s) URL without credentials")
    for item in config.get("containers", []):
        unique(item, "container")
        require(isinstance(item.get("container"), str) and NAME.fullmatch(item["container"]), "Invalid container name")
    for item in config.get("commands", []):
        unique(item, "command")
        argv = item.get("argv")
        require(isinstance(argv, list) and argv and all(isinstance(part, str) for part in argv),
                "Command probes need a non-empty argv list (no shell)")
        require(isinstance(item.get("max", {}), dict), "Command probe limits must be an object")
    release = config.get("release")
    if release is not None:
        require(isinstance(release, dict) and isinstance(release.get("file"), str), "release needs a file path")
    require(names or release, "Configure at least one probe")
    return config


def outcome(item, kind, ok, started, detail):
    return {"name": item["name"], "kind": kind, "ok": bool(ok),
            "ms": int((time.monotonic() - started) * 1000), "detail": detail}


def probe_http(item):
    started = time.monotonic()
    request = urllib.request.Request(item["url"], method="GET")
    try:
        with urllib.request.urlopen(request, timeout=item.get("timeoutSeconds", 5)) as response:
            status = response.status
    except urllib.error.HTTPError as error:
        status = error.code
    except (urllib.error.URLError, OSError, TimeoutError) as error:
        return outcome(item, "http", False, started, {"error": type(error).__name__})
    return outcome(item, "http", status == item.get("expectStatus", 200), started, {"status": status})


def probe_container(item):
    started = time.monotonic()
    try:
        result = subprocess.run(["docker", "inspect", item["container"]], capture_output=True, text=True,
                                timeout=item.get("timeoutSeconds", 15), check=False)
        if result.returncode != 0:
            return outcome(item, "container", False, started, {"error": "inspect-failed"})
        inspected = json.loads(result.stdout)[0]
    except (OSError, subprocess.TimeoutExpired, ValueError, IndexError) as error:
        return outcome(item, "container", False, started, {"error": type(error).__name__})
    state = inspected.get("State", {})
    health = (state.get("Health") or {}).get("Status")
    detail = {"status": scalar(state.get("Status")), "oomKilled": bool(state.get("OOMKilled")),
              "restartCount": int(inspected.get("RestartCount", 0)), "startedAt": scalar(state.get("StartedAt")),
              "image": scalar(inspected.get("Image"))}
    if health is not None:
        detail["health"] = scalar(health)
    ok = state.get("Status") == "running" and not state.get("OOMKilled") and health in (None, "healthy")
    return outcome(item, "container", ok, started, detail)


def probe_command(item):
    started = time.monotonic()
    try:
        result = subprocess.run(item["argv"], capture_output=True, text=True, timeout=item.get("timeoutSeconds", 20),
                                check=False, shell=False)
        if result.returncode != 0:
            return outcome(item, "command", False, started, {"error": "exit-nonzero", "exit": result.returncode})
        document = json.loads(result.stdout)
        require(isinstance(document, dict), "The command must print one JSON object")
    except (OSError, subprocess.TimeoutExpired, ValueError) as error:
        return outcome(item, "command", False, started, {"error": type(error).__name__})
    detail = {key: scalar(value) for key, value in document.items() if scalar(value) is not None}
    exceeded = [key for key, limit in item.get("max", {}).items()
                if not isinstance(detail.get(key), (int, float)) or isinstance(detail.get(key), bool) or detail[key] > limit]
    if exceeded:
        detail["exceeded"] = sorted(exceeded)
    return outcome(item, "command", not exceeded, started, detail)


def probe_release(release):
    started = time.monotonic()
    item = {"name": "release"}
    try:
        value = Path(release["file"]).read_text(encoding="utf-8").strip().splitlines()[0].lower()
    except (OSError, IndexError):
        return None, outcome(item, "release", False, started, {"error": "unreadable"})
    if not SHA.fullmatch(value):
        return None, outcome(item, "release", False, started, {"error": "not-a-sha"})
    return value, outcome(item, "release", True, started, {})


def collect(config, clock=utc_now):
    probes = []
    release = None
    if config.get("release"):
        release, probe = probe_release(config["release"])
        probes.append(probe)
    for key, function in (("http", probe_http), ("containers", probe_container), ("commands", probe_command)):
        for item in config.get(key, []):
            try:
                probes.append(function(item))
            except Exception as error:  # a probe must never prevent the sample from being recorded
                probes.append({"name": item["name"], "kind": key, "ok": False, "ms": 0,
                               "detail": {"error": type(error).__name__}})
    return {"v": SCHEMA, "t": stamp(clock()), "release": release, "ok": all(p["ok"] for p in probes), "probes": probes}


def append_sample(ledger, sample):
    path = Path(ledger)
    require(not path.is_symlink(), "The ledger must not be a symbolic link")
    descriptor = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    try:
        mode = os.fstat(descriptor).st_mode
        require(stat.S_ISREG(mode), "The ledger must be a regular file")
        os.write(descriptor, (json.dumps(sample, separators=(",", ":"), sort_keys=True) + "\n").encode("utf-8"))
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def read_ledger(ledger):
    samples, corrupt = [], 0
    for line in Path(ledger).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            sample = json.loads(line)
            require(sample["v"] == SCHEMA and isinstance(sample["probes"], list), "unsupported sample")
            sample["_t"] = parse_time(sample["t"])
            samples.append(sample)
        except (ValueError, KeyError, TypeError):
            corrupt += 1
    return samples, corrupt


def containers_of(sample):
    return {p["name"]: p["detail"] for p in sample["probes"] if p["kind"] == "container"}


def signature(sample):
    return (sample.get("release"),
            tuple(sorted((name, detail.get("image")) for name, detail in containers_of(sample).items())))


def restart_events(segment):
    events = []
    for before, after in zip(segment, segment[1:]):
        previous = containers_of(before)
        for name, detail in containers_of(after).items():
            old = previous.get(name)
            if detail.get("oomKilled"):
                events.append({"t": after["t"], "container": name, "reason": "oom-killed"})
            elif old and (detail.get("restartCount", 0) > old.get("restartCount", 0)
                          or detail.get("startedAt") != old.get("startedAt")):
                events.append({"t": after["t"], "container": name, "reason": "restarted"})
    return events


def evaluate(samples, corrupt=0, end=None, max_gap=300, min_hours=24, allowed_failures=0):
    """Evaluate the trailing window: it starts at the last release/image change."""
    # Written order must be time order: a backwards step means the clock moved or the ledger was edited.
    regressions = sum(1 for before, after in zip(samples, samples[1:]) if after["_t"] < before["_t"])
    samples = sorted(samples, key=lambda sample: sample["_t"])
    report = {"samples": len(samples), "corruptLines": corrupt, "clockRegressions": regressions}
    if not samples:
        return {**report, "pass": False, "reasons": ["no samples recorded"]}
    first = 0
    changes = []
    for index in range(1, len(samples)):
        if signature(samples[index]) != signature(samples[index - 1]):
            first = index
            changes.append({"t": samples[index]["t"], "release": samples[index].get("release")})
    segment = samples[first:]
    window_start = segment[0]["_t"]
    window_end = end or utc_now()
    points = [window_start] + [sample["_t"] for sample in segment] + [window_end]
    gaps = [{"from": stamp(a), "seconds": int((b - a).total_seconds())}
            for a, b in zip(points, points[1:]) if (b - a).total_seconds() > max_gap]
    longest = max(int((b - a).total_seconds()) for a, b in zip(points, points[1:]))
    failed = [{"t": s["t"], "probes": [p["name"] for p in s["probes"] if not p["ok"]]} for s in segment if not s["ok"]]
    restarts = restart_events(segment)
    duration = (window_end - window_start).total_seconds()
    reasons = []
    if duration < min_hours * 3600:
        reasons.append(f"window is {duration / 3600:.2f}h, below the required {min_hours}h")
    if longest > max_gap:
        reasons.append(f"longest gap {longest}s exceeds {max_gap}s")
    if len(failed) > allowed_failures:
        reasons.append(f"{len(failed)} sample(s) had a failed probe")
    if restarts:
        reasons.append(f"{len(restarts)} unexpected restart/OOM event(s)")
    if corrupt:
        reasons.append(f"{corrupt} unreadable ledger line(s)")
    if regressions:
        reasons.append(f"{regressions} clock regression(s)")
    return {**report, "windowStart": stamp(window_start), "windowEnd": stamp(window_end),
            "windowSeconds": int(duration), "windowSamples": len(segment), "release": segment[0].get("release"),
            "previousChanges": changes, "longestGapSeconds": longest, "gaps": gaps[:50], "failedSamples": failed[:50],
            "restartEvents": restarts[:50], "pass": not reasons, "reasons": reasons}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    collect_parser = commands.add_parser("collect", help="append one sample to the ledger")
    collect_parser.add_argument("--config", required=True)
    collect_parser.add_argument("--ledger", required=True)
    report_parser = commands.add_parser("report", help="evaluate the trailing observation window")
    report_parser.add_argument("--ledger", required=True)
    report_parser.add_argument("--end", help="ISO UTC time; defaults to now")
    report_parser.add_argument("--max-gap-seconds", type=int, default=300)
    report_parser.add_argument("--min-hours", type=float, default=24)
    report_parser.add_argument("--allowed-failed-samples", type=int, default=0)
    args = parser.parse_args(argv)
    try:
        if args.command == "collect":
            sample = collect(load_config(args.config))
            append_sample(args.ledger, sample)
            print(json.dumps({"t": sample["t"], "ok": sample["ok"], "failed": [p["name"] for p in sample["probes"] if not p["ok"]]}))
            return 0
        samples, corrupt = read_ledger(args.ledger)
        result = evaluate(samples, corrupt, parse_time(args.end) if args.end else None, args.max_gap_seconds,
                          args.min_hours, args.allowed_failed_samples)
        print(json.dumps(result, indent=2))
        return 0 if result["pass"] else 1
    except (OSError, ValueError) as error:
        print(f"observe: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
