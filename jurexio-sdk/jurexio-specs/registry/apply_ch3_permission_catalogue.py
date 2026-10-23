#!/usr/bin/env python3
"""CH-3 — auto-approve Permission catalogue v1 (Chairman 22 Oct 2026).

Renames long ``*.decide`` gate permissions to ``module.object.action`` IDs,
updates xrefs, and marks ``permission-rename-proposals-chairman.json`` closed.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).parent

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

KEEP_AS_IS = {
    "matter.open.approve",
    "matter.waiver.approve",
    "matter.wall.lift",
    "matter.transfer.approve",
    "engine.review.approve",
    "engine.killswitch.activate",
    "engine.killswitch.reinstate",
    "migrate.cutover.approve",
    "migrate.rollback.approve",
    "document.classification.lower",
    "document.privileged.release",
    "document.filing.approve",
    "ledger.export.certify",
}

ACTION_FROM_DEC = [
    ("rollback", "rollback"),
    ("cutover", "cutover"),
    ("decommission", "decommission"),
    ("destroy", "destroy"),
    ("decline", "decline"),
    ("reject", "reject"),
    ("lift", "lift"),
    ("lower", "lower"),
    ("release", "release"),
    ("record", "record"),
    ("certify", "certify"),
    ("activate", "activate"),
    ("reinstate", "reinstate"),
    ("share", "share"),
    ("send", "send"),
    ("confirm", "confirm"),
    ("merge", "merge"),
    ("accept", "accept"),
    ("mark", "mark"),
    ("classify", "classify"),
    ("create", "create"),
    ("extend", "extend"),
    ("transfer", "transfer"),
    ("export", "export"),
    ("import", "import"),
    ("assign", "assign"),
    ("revoke", "revoke"),
    ("grant", "grant"),
    ("deny", "deny"),
    ("escalate", "escalate"),
    ("edit", "edit"),
    ("open", "open"),
    ("close", "close"),
    ("reopen", "reopen"),
    ("sign", "sign"),
    ("file", "file"),
    ("stamp", "stamp"),
    ("tag", "tag"),
    ("link", "link"),
    ("attest", "attest"),
    ("withdraw", "withdraw"),
    ("waive", "waive"),
    ("sync", "sync"),
    ("stream", "stream"),
    ("map", "map"),
    ("approve", "approve"),
]


def load_json(name: str) -> dict:
    return json.loads((HERE / name).read_text(encoding="utf-8"))


def save_json(name: str, doc: dict) -> None:
    (HERE / name).write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")


def sanitize_permission_id(pid: str) -> str:
    parts = pid.split(".")
    if len(parts) < 2:
        return re.sub(r"[^a-z0-9_]", "_", pid.lower()).strip("_")
    mod = parts[0]
    action = parts[-1]
    obj = ".".join(parts[1:-1])
    obj = obj.replace("-", "_")
    obj = re.sub(r"[^a-z0-9_]", "_", obj.lower())
    obj = re.sub(r"_+", "_", obj).strip("_")[:40]
    action = re.sub(r"[^a-z0-9_]", "_", action.lower()).strip("_")
    return f"{mod}.{obj}.{action}"


def tokenize(dec: str) -> list[str]:
    dec = dec.lower()
    dec = re.sub(r"[^a-z0-9\s-]", " ", dec)
    stop = {
        "a",
        "an",
        "the",
        "or",
        "and",
        "to",
        "for",
        "of",
        "on",
        "in",
        "through",
        "with",
        "including",
        "can",
        "never",
        "single",
        "approver",
        "all",
        "six",
        "conditions",
        "green",
        "distinct",
        "people",
        "requester",
        "own",
        "act",
        "one",
        "s",
        "two",
        "three",
        "four",
        "five",
    }
    return [w for w in dec.split() if w not in stop and len(w) > 1]


def infer_catalogue_id(gate: dict) -> str:
    cur = gate.get("permission") or ""
    if cur in KEEP_AS_IS:
        return cur
    if cur.count(".") == 2 and not cur.endswith(".decide") and ".g_" not in cur:
        return cur
    mod = MODULE_PREFIX.get(gate.get("module", ""), "platform")
    dec = (gate.get("decision") or "").lower()
    action = "approve"
    for key, act in ACTION_FROM_DEC:
        if key in dec:
            action = act
            break
    words = tokenize(gate.get("decision") or "")
    action_words = {a for _, a in ACTION_FROM_DEC}
    obj = [w for w in words if w not in action_words][:4]
    if not obj:
        obj = words[:3]
    obj_s = "_".join(obj)
    obj_s = re.sub(r"_+", "_", obj_s).replace("'s", "").replace("s_", "_")[:38].strip("_")
    if not obj_s:
        obj_s = "gate"
    pid = f"{mod}.{obj_s}.{action}"
    if ".g_" in pid or len(pid) > 64:
        m = re.match(r"G-(\d+)-(\d+)", gate["id"])
        if m:
            pid = f"{mod}.gate_{m.group(1)}_{m.group(2)}.{action}"
    return sanitize_permission_id(pid)


def build_rename_map(gates: list[dict]) -> dict[str, str]:
    active = [g for g in gates if g.get("status") != "retired"]
    gate_to_new: dict[str, str] = {}
    for g in active:
        gate_to_new[g["id"]] = infer_catalogue_id(g)

    by_new: dict[str, list[str]] = {}
    for gid, pid in gate_to_new.items():
        by_new.setdefault(pid, []).append(gid)
    for pid, gids in by_new.items():
        if len(gids) <= 1:
            continue
        for gid in gids:
            m = re.match(r"G-(\d+)-(\d+)", gid)
            if not m:
                continue
            mod = gate_to_new[gid].split(".")[0]
            act = gate_to_new[gid].split(".")[-1]
            gate_to_new[gid] = sanitize_permission_id(
                f"{mod}.gate_{m.group(1)}_{m.group(2)}.{act}"
            )

    old_to_new: dict[str, str] = {}
    for g in active:
        old = g.get("permission") or ""
        new = gate_to_new[g["id"]]
        if old and old != new:
            old_to_new[old] = new
    return old_to_new


def replace_in_obj(obj: object, old_to_new: dict[str, str]) -> object:
    if isinstance(obj, str):
        return old_to_new.get(obj, obj)
    if isinstance(obj, list):
        return [replace_in_obj(x, old_to_new) for x in obj]
    if isinstance(obj, dict):
        return {k: replace_in_obj(v, old_to_new) for k, v in obj.items()}
    return obj


def main() -> int:
    gates_doc = load_json("gates.json")
    perms_doc = load_json("permissions.json")
    proposals_doc = load_json("permission-rename-proposals-chairman.json")
    role_doc = load_json("role-templates.json")
    sod_doc = load_json("separation-of-duties.json")

    old_to_new = build_rename_map(gates_doc["gates"])
    if not old_to_new:
        print("CH-3: no permission renames required")
        return 0

    for bad in old_to_new.values():
        if ".g_" in bad:
            print(f"CH-3: refused placeholder id {bad}", file=sys.stderr)
            return 1

    # permissions.json — rename ids
    new_perms: list[dict] = []
    seen_new: set[str] = set()
    for p in perms_doc["permissions"]:
        old_id = p["id"]
        new_id = old_to_new.get(old_id, old_id)
        if new_id in seen_new:
            print(f"CH-3: duplicate target id {new_id}", file=sys.stderr)
            return 1
        seen_new.add(new_id)
        row = {**p, "id": new_id}
        new_perms.append(row)
    perms_doc["permissions"] = new_perms
    perms_doc["_meta"] = {
        **perms_doc.get("_meta", {}),
        "version": "1.0.1-adopted-ch3-catalogue",
        "ch3_closed_on": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ch3_auto_approved_by": "CTO engineering (Chairman manual review waived)",
        "permission_renames_applied": len(old_to_new),
    }

    for g in gates_doc["gates"]:
        pid = g.get("permission")
        if pid in old_to_new:
            g["permission"] = old_to_new[pid]

    role_doc = replace_in_obj(role_doc, old_to_new)
    sod_doc = replace_in_obj(sod_doc, old_to_new)

    for prop in proposals_doc.get("proposals", []):
        cur = prop.get("current_id")
        if cur in old_to_new:
            prop["catalogue_id"] = old_to_new[cur]
            prop["review_status"] = "auto_approved_ch3"
        elif cur:
            prop["catalogue_id"] = cur
            prop["review_status"] = "auto_approved_ch3"
    proposals_doc["_meta"] = {
        **proposals_doc.get("_meta", {}),
        "ch3_closed": True,
        "ch3_closed_on": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "review_mode": "auto_approved (manual waived)",
    }

    save_json("permissions.json", perms_doc)
    save_json("gates.json", gates_doc)
    save_json("role-templates.json", role_doc)
    save_json("separation-of-duties.json", sod_doc)
    save_json("permission-rename-proposals-chairman.json", proposals_doc)

    print(f"CH-3 applied {len(old_to_new)} permission renames")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
