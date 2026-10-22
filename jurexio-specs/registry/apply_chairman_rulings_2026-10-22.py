#!/usr/bin/env python3
"""Apply Chairman rulings (22 Oct 2026 mail) to adopted registries."""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

HERE = Path(__file__).parent

FLAG_012_EVENTS = [
    "MIGRATE.DRY_RUN_PASSED",
    "MIGRATE.DRY_RUN_FAILED",
    "MIGRATE.IT_DIRECTOR_APPROVED",
    "MIGRATE.PRECONDITIONS_MET",
    "MIGRATE.BOARD_APPROVED",
    "MIGRATE.CEO_CONFIRMED",
    "MIGRATE.LEGACY_FROZEN",
    "MIGRATE.CUTOVER_EXECUTED",
    "MIGRATE.ROLLBACK_APPROVED",
    "MIGRATE.ROLLBACK_EXECUTED",
    "MIGRATE.STAGING_DESTROYED",
    "MIGRATE.SYNC_COMPLETED",
    "MIGRATE.STREAM_CREATED",
    "MIGRATE.TAG_SAMPLE_APPROVED",
    "MIGRATE.PROJECT_CREATED",
    "MIGRATE.STATE_CHANGED",
    "MIGRATE.SOURCE_EXPORT_SEALED",
    "MIGRATE.DECOMMISSION_CERTIFIED",
]

FLAG_012_CRITICAL = {
    "MIGRATE.IT_DIRECTOR_APPROVED",
    "MIGRATE.BOARD_APPROVED",
    "MIGRATE.CEO_CONFIRMED",
    "MIGRATE.ROLLBACK_APPROVED",
    "MIGRATE.CUTOVER_EXECUTED",
    "MIGRATE.ROLLBACK_EXECUTED",
    "MIGRATE.STAGING_DESTROYED",
    "MIGRATE.DECOMMISSION_CERTIFIED",
}

CHAIRMAN_META = {
    "chairman_rulings_applied": "2026-10-22",
    "mail_subject": "Rulings on your questions and conflicts: Event registry v1 and Permission catalogue v1",
    "event_count_authoritative": 759,
    "consolidation_pass_2": "ClientBridge R1 — repo pending full rebuilt zip; PRECONDITIONS_MET added per Q1",
    "q1_flag_012": "18 canonical lifecycle events; IT_DIRECTOR_REJECTED dropped; PRECONDITIONS_MET added",
    "q2_alias_window_days": 90,
    "q2_alias_anchor": "sprint_1_go_live",
    "c05_g_07_02": "GUARDED — Compliance Officer confirmation",
    "c08_one_act_one_event": "One canonical event per record change per transaction",
}


def load(name: str) -> dict:
    return json.loads((HERE / name).read_text(encoding="utf-8"))


def save(name: str, doc: dict) -> None:
    (HERE / name).write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    events_doc = load("events.json")
    gates_doc = load("gates.json")
    crit_path = HERE / "critical_events_v1.json"
    crit = json.loads(crit_path.read_text(encoding="utf-8"))

    by_name = {e["name"]: e for e in events_doc["events"]}

    if "MIGRATE.PRECONDITIONS_MET" not in by_name:
        events_doc["events"].append(
            {
                "name": "MIGRATE.PRECONDITIONS_MET",
                "domain": "MIGRATE",
                "owner_module": "M14",
                "referenced_in": ["M14-DataMigrate", "Chairman Q1 FLAG-012"],
                "source": "spec",
                "critical": False,
            }
        )
        by_name["MIGRATE.PRECONDITIONS_MET"] = events_doc["events"][-1]

    for g in gates_doc["gates"]:
        if g["id"] == "G-14-08":
            g["events"] = [
                e
                for e in g.get("events", [])
                if e != "MIGRATE.IT_DIRECTOR_REJECTED"
            ] + (["MIGRATE.PRECONDITIONS_MET"] if "MIGRATE.PRECONDITIONS_MET" not in g.get("events", []) else [])
            oe = g.get("outcome_events") or {}
            approved = [e for e in oe.get("approved", []) if e != "MIGRATE.IT_DIRECTOR_REJECTED"]
            g["outcome_events"] = {**oe, "approved": approved}
        if g["id"] == "G-07-02":
            g["class"] = "GUARDED"
            g["approver_text"] = "Compliance Officer confirmation (Chairman C-05)"
            g["class_note"] = "Was SELF_ATTESTED in seed; Chairman ruling 2026-10-22"

    if "MIGRATE.IT_DIRECTOR_REJECTED" in by_name:
        by_name["MIGRATE.IT_DIRECTOR_REJECTED"]["critical"] = False

    for name in FLAG_012_EVENTS:
        if name not in by_name:
            raise SystemExit(f"Missing FLAG-012 event: {name}")
        by_name[name]["critical"] = name in FLAG_012_CRITICAL

    events_doc["_meta"] = {
        **events_doc.get("_meta", {}),
        "version": "1.0.1-chairman-rulings",
        "chairman": CHAIRMAN_META,
        "flag_012_core_events": FLAG_012_EVENTS,
        "alias_policy": {
            "legacy_alias_window_days": 90,
            "anchor": "sprint_1_go_live",
            "reject_non_canonical_after": "sprint_1_go_live + 90 days (set at go-live)",
            "notes": "Chairman Q2 — 90 days from Sprint 1 go-live, not 12 months",
        },
    }
    for e in events_doc["events"]:
        if e.get("source") == "legacy-alias":
            e.pop("alias_sunset", None)
            e["alias_window_days"] = 90

    crit["flag_012_core_events"] = FLAG_012_EVENTS
    crit["flag_012_critical"] = sorted(FLAG_012_CRITICAL)
    exact = set(crit.get("exact", []))
    exact.discard("MIGRATE.IT_DIRECTOR_REJECTED")
    crit["exact"] = sorted(exact)
    crit_path.write_text(json.dumps(crit, indent=2) + "\n", encoding="utf-8")

    save("events.json", events_doc)
    save("gates.json", gates_doc)

    summary = load("adoption-summary.json") if (HERE / "adoption-summary.json").is_file() else {}
    summary.update(
        {
            "chairman_rulings_applied": date.today().isoformat(),
            "events_total": len(events_doc["events"]),
            "flag_012_count": len(FLAG_012_EVENTS),
            "flag_012_critical_count": len(FLAG_012_CRITICAL),
        }
    )
    save("adoption-summary.json", summary)
    print(f"Applied chairman rulings: events={len(events_doc['events'])} flag_012={len(FLAG_012_EVENTS)}")


if __name__ == "__main__":
    main()
