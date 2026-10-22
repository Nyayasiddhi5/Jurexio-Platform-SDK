"""Validate the Jurexio registries against their JSON Schemas and cross-check references.
Usage: pip install jsonschema && python registry/validate.py"""
import json
import sys
import pathlib
from jsonschema import Draft202012Validator

here = pathlib.Path(__file__).parent
ok = True
data = {}
for n in ["gates", "events", "permissions", "interface-contracts", "constants"]:
    doc = json.loads((here / f"{n}.json").read_text(encoding="utf-8"))
    schema = json.loads((here / "schema" / f"{n}.schema.json").read_text(encoding="utf-8"))
    errs = list(Draft202012Validator(schema).iter_errors(doc))
    for e in errs[:20]:
        print(f"[{n}] {list(e.path)}: {e.message}")
    ok &= not errs
    data[n] = doc

events = {e["name"] for e in data["events"]["events"]}
perms = {p["id"] for p in data["permissions"]["permissions"]}
for g in data["gates"]["gates"]:
    for e in g.get("events", []):
        if e not in events:
            print(f"[xref] {g['id']} references unknown event {e}")
            ok = False
    if g.get("permission") and g["permission"] not in perms:
        print(f"[xref] {g['id']} references unknown permission {g['permission']}")
        ok = False

# Post-adoption invariants (Chairman 25 Oct)
ev_meta = data["events"].get("_meta", {})
if "adopted" not in str(ev_meta.get("version", "")):
    print("[adoption] events._meta.version must contain 'adopted' after v1 adoption")
    ok = False
null_critical = [e["name"] for e in data["events"]["events"] if e.get("critical") is None]
if null_critical:
    print(f"[adoption] {len(null_critical)} events still have critical=null")
    ok = False

for optional in ["role-templates.json", "separation-of-duties.json", "l1-l9-retirement-map.json"]:
    path = here / optional
    if not path.is_file():
        print(f"[adoption] missing required v1 artefact {optional}")
        ok = False

print("OK" if ok else "FAILED")
sys.exit(0 if ok else 1)
