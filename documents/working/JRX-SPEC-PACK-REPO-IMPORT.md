# Jurexio spec pack — repository import

**Tracker:** 2026-10-22T08:15:00Z  
**Authority:** Chairman GO — Event/Permission registries due 25 Oct 2026.

## Location

| Path | Contents |
| --- | --- |
| `jurexio-specs/specs/` | 14 module Markdown specs + `MODULE-REGISTER.md` |
| `jurexio-specs/registry/` | `gates.json`, `events.json`, `permissions.json`, `interface-contracts.json`, `constants.json`, schemas, `validate.py` |
| `jurexio-specs/.cursor/rules/jurexio-specs.mdc` | Cursor rule for module/registry work |

Claude Docs remain source of truth; re-export into this tree — do not edit specs for product truth without Doc update.

## Validation

```bash
pip install jsonschema   # once per machine
npm run registry:validate
# or: python3 jurexio-specs/registry/validate.py
```

CI runs `validate.py` on every PR and `main` push (`.github/workflows/jrx-ci.yml`).

## CTO next (25 Oct)

See Project store: Chairman requirements + questions/conflicts docs (registry adoption, critical flags, permission rename).
