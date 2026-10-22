"""Validate Jurexio registries — JSON Schema + adoption compliance (Event/Permission v1).

Usage: pip install jsonschema && python jurexio-specs/registry/validate.py
"""
from __future__ import annotations

import json
import pathlib
import re
import sys
from collections import Counter

from jsonschema import Draft202012Validator

here = pathlib.Path(__file__).parent
ok = True
data: dict = {}


def fail(msg: str) -> None:
    global ok
    print(msg)
    ok = False


for n in ["gates", "events", "permissions", "interface-contracts", "constants"]:
    doc = json.loads((here / f"{n}.json").read_text(encoding="utf-8"))
    schema = json.loads((here / "schema" / f"{n}.schema.json").read_text(encoding="utf-8"))
    errs = list(Draft202012Validator(schema).iter_errors(doc))
    for e in errs[:25]:
        print(f"[schema:{n}] {list(e.path)}: {e.message}")
    ok &= not errs
    data[n] = doc

event_rows = data["events"]["events"]
events_by_name = {e["name"]: e for e in event_rows}
events = set(events_by_name)
perms = {p["id"]: p for p in data["permissions"]["permissions"]}

# Gate ↔ event / permission xrefs
for g in data["gates"]["gates"]:
    if g.get("status") == "retired":
        continue
    for e in g.get("events", []):
        if e not in events:
            fail(f"[xref] {g['id']} references unknown event {e}")
    oe = g.get("outcome_events") or {}
    for key in ("approved",):
        for ev in oe.get(key) or []:
            if ev not in events:
                fail(f"[xref] {g['id']} outcome approved unknown event {ev}")
    for key in ("rejected", "withdrawn"):
        ev = oe.get(key)
        if ev and ev not in events:
            fail(f"[xref] {g['id']} outcome {key} unknown event {ev}")
    pid = g.get("permission")
    if pid and pid not in perms:
        fail(f"[xref] {g['id']} references unknown permission {pid}")
    if g.get("status") != "adopted":
        fail(f"[adoption] gate {g['id']} status is not adopted")

# Permission catalogue
for p in data["permissions"]["permissions"]:
    if p.get("status") != "adopted":
        fail(f"[adoption] permission {p['id']} status is not adopted")
    if ".g_" in p["id"]:
        fail(f"[adoption] placeholder permission id remains: {p['id']}")
    if "step_up_required" not in p or "protected" not in p:
        fail(f"[adoption] permission {p['id']} missing protected/step_up_required")

# Events
dupes = [name for name, c in Counter(e["name"] for e in event_rows).items() if c > 1]
if dupes:
    fail(f"[events] duplicate names: {dupes[:5]}")

null_critical = [e["name"] for e in event_rows if e.get("critical") is None]
if null_critical:
    fail(f"[adoption] {len(null_critical)} events still have critical=null")

for e in event_rows:
    if e.get("source") == "legacy-alias":
        if not e.get("maps_to"):
            fail(f"[alias] {e['name']} legacy-alias missing maps_to")
        if e["maps_to"] not in events:
            fail(f"[alias] {e['name']} maps_to unknown {e.get('maps_to')}")

flag_012 = data["events"].get("_meta", {}).get("flag_012_core_events") or []
for name in flag_012:
    ev = events_by_name.get(name)
    if not ev:
        fail(f"[flag-012] missing event {name}")
    elif not ev.get("critical"):
        fail(f"[flag-012] {name} must be critical=true")

# _meta adoption markers
for key in ("events", "permissions", "gates"):
    doc = data[key]
    ver = str(doc.get("_meta", {}).get("version", ""))
    if "adopted" not in ver:
        fail(f"[adoption] {key}._meta.version must contain 'adopted' (got {ver!r})")

# v1 artefacts
for fname in [
    "role-templates.json",
    "separation-of-duties.json",
    "l1-l9-retirement-map.json",
    "CTO-GATE-CLASS-CONFIRMATION.md",
    "adoption-summary.json",
]:
    if not (here / fname).is_file():
        fail(f"[adoption] missing v1 artefact {fname}")

rt = json.loads((here / "role-templates.json").read_text(encoding="utf-8"))
for t in rt.get("role_templates", []):
    for pid in t.get("permissions", []):
        if pid not in perms:
            fail(f"[role-template] {t['id']} references unknown permission {pid}")

# Gate outcome naming (E1 spot check)
bad_outcomes = []
for e in event_rows:
    if e.get("source") != "generated-gate-outcome":
        continue
    if not re.match(r"^[A-Z]+\.G_\d+_\d+_(REJECTED|WITHDRAWN)$", e["name"]):
        bad_outcomes.append(e["name"])
if bad_outcomes:
    fail(f"[E1] {len(bad_outcomes)} gate outcomes violate G_NN_NN naming")

print("OK" if ok else "FAILED")
sys.exit(0 if ok else 1)
