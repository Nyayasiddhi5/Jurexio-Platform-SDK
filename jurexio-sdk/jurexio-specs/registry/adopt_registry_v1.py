#!/usr/bin/env python3
"""CTO adoption pass — Event registry v1 + Permission catalogue v1 (Chairman 25 Oct 2026)."""
from __future__ import annotations

import json
import re
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent.parent

MODULE_PREFIX = {
    "M01": "matter",
    "M02": "document",
    "M03": "engine",
    "M04": "lexgraph",
    "M05": "deadline",
    "M06": "billguard",
    "M07": "regradar",
    "M08": "clientbridge",
    "M09": "ledger",
    "M10": "nexus",
    "M11": "access",
    "M12": "comms",
    "M13": "storage",
    "M14": "migrate",
}


def slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return s[:56] or "decide"


def load_json(name: str) -> dict:
    return json.loads((HERE / name).read_text(encoding="utf-8"))


def save_json(name: str, doc: dict) -> None:
    (HERE / name).write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")


def is_critical(name: str, crit: dict, gate_critical_approved: set[str]) -> bool:
    if name in crit.get("exact", []):
        return True
    if name in crit.get("flag_012_core_events", []):
        return True
    if name in gate_critical_approved:
        return True
    for p in crit.get("prefixes", []):
        if name.startswith(p):
            return True
    for sub in crit.get("substrings", []):
        if sub in name:
            return True
    if name.endswith("_REJECTED") or name.endswith("_WITHDRAWN"):
        base = name.rsplit("_", 1)[0]
        if any(base.endswith(x) for x in ("REJECTED", "WITHDRAWN")):
            pass
        # Gate outcomes inherit if approved twin would be critical — check G_NN_NN pattern
        m = re.match(r"^([A-Z]+)\.G_\d+_\d+_(REJECTED|WITHDRAWN)$", name)
        if m:
            approved_like = name.replace("_REJECTED", "").replace("_WITHDRAWN", "")
            return False
    return False


def build_gate_critical_approved(gates: dict, crit: dict) -> set[str]:
    approved: set[str] = set()
    for g in gates["gates"]:
        if g.get("status") == "retired":
            continue
        for ev in g.get("outcome_events", {}).get("approved", []):
            if isinstance(ev, str):
                approved.add(ev)
        evs = g.get("events") or []
        for ev in evs:
            approved.add(ev)
    # Narrow: only those matching critical heuristics
    out = set()
    for ev in approved:
        if is_critical(ev, crit, set()):
            out.add(ev)
    return out


def rename_permission(gate: dict, existing_ids: set[str]) -> str:
    old = gate.get("permission") or ""
    if old and ".g_" not in old and ".gate_" not in old:
        return old
    mod = MODULE_PREFIX.get(gate.get("module", ""), "platform")
    decision = gate.get("decision") or gate.get("id", "decide")
    base = f"{mod}.{slug(decision)}.decide"
    pid = base
    n = 2
    while pid in existing_ids and pid != old:
        pid = f"{base}_{n}"
        n += 1
    return pid


def main() -> int:
    crit = load_json("critical_events_v1.json")
    events_doc = load_json("events.json")
    gates_doc = load_json("gates.json")
    perms_doc = load_json("permissions.json")

    gate_crit = build_gate_critical_approved(gates_doc, crit)

    # Events
    alias_sunset = "2027-10-26"
    events_doc["_meta"] = {
        **events_doc.get("_meta", {}),
        "version": "1.0.0-adopted",
        "adopted_on": date.today().isoformat(),
        "adopted_by": "CTO Event registry v1",
        "gate_outcome_naming": "DOMAIN.G_NN_NN_REJECTED / DOMAIN.G_NN_NN_WITHDRAWN (adopted)",
        "alias_policy": {
            "legacy_alias_accept_until": alias_sunset,
            "reject_non_canonical_after": alias_sunset,
            "notes": "12 legacy-alias rows map to canonical names via maps_to",
        },
        "flag_012_core_events": crit["flag_012_core_events"],
        "canonical_event_rule": "One human act → one canonical event; owning module owns the record.",
    }
    c_true = c_false = 0
    for ev in events_doc["events"]:
        name = ev["name"]
        ev["critical"] = is_critical(name, crit, gate_crit)
        if ev.get("source") == "legacy-alias":
            ev["alias_sunset"] = alias_sunset
        if ev["critical"]:
            c_true += 1
        else:
            c_false += 1

    # Permissions rename + adopt
    perm_by_id = {p["id"]: p for p in perms_doc["permissions"]}
    existing_ids = set(perm_by_id.keys())
    renames: dict[str, str] = {}

    for g in gates_doc["gates"]:
        if g.get("status") == "retired":
            continue
        old_perm = g.get("permission")
        if not old_perm:
            continue
        if ".g_" in old_perm or old_perm.endswith(".decide") and re.match(r"^[a-z]+\.g_\d+_\d+\.decide$", old_perm):
            new_perm = rename_permission(g, existing_ids)
            if new_perm != old_perm:
                renames[old_perm] = new_perm
                g["permission"] = new_perm
                if old_perm in perm_by_id and new_perm not in perm_by_id:
                    p = dict(perm_by_id[old_perm])
                    p["id"] = new_perm
                    p["status"] = "adopted"
                    perm_by_id[new_perm] = p
                    del perm_by_id[old_perm]
                    existing_ids.discard(old_perm)
                    existing_ids.add(new_perm)
                elif new_perm in perm_by_id:
                    g["permission"] = new_perm
        g["status"] = "adopted"

    for p in perm_by_id.values():
        if p.get("status") == "proposed-v0":
            p["status"] = "adopted"

    perms_doc["permissions"] = sorted(perm_by_id.values(), key=lambda x: x["id"])
    perms_doc["_meta"] = {
        **perms_doc.get("_meta", {}),
        "version": "1.0.0-adopted",
        "adopted_on": date.today().isoformat(),
        "adopted_by": "CTO Permission catalogue v1",
        "permission_renames_from_gate_placeholders": len(renames),
    }

    gates_doc["_meta"] = {
        **gates_doc.get("_meta", {}),
        "version": "1.0.0-adopted",
        "adopted_on": date.today().isoformat(),
    }

    save_json("events.json", events_doc)
    save_json("gates.json", gates_doc)
    save_json("permissions.json", perms_doc)
    save_json(
        "adoption-summary.json",
        {
            "events_total": len(events_doc["events"]),
            "critical_true": c_true,
            "critical_false": c_false,
            "permissions_total": len(perms_doc["permissions"]),
            "permission_renames": renames,
            "gates_adopted": sum(1 for g in gates_doc["gates"] if g.get("status") == "adopted"),
        },
    )

    print(f"Adopted: events={len(events_doc['events'])} critical_true={c_true} critical_false={c_false}")
    print(f"Permissions={len(perms_doc['permissions'])} renames={len(renames)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
