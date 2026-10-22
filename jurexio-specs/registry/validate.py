"""Validate the Jurexio registries against their JSON Schemas and cross-check references.
Usage: pip install jsonschema && python registry/validate.py"""
import json, sys, pathlib
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
            print(f"[xref] {g['id']} references unknown event {e}"); ok = False
    if g.get("permission") and g["permission"] not in perms:
        print(f"[xref] {g['id']} references unknown permission {g['permission']}"); ok = False
print("OK" if ok else "FAILED")
sys.exit(0 if ok else 1)
