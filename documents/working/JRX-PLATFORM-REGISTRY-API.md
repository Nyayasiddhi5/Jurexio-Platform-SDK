# Platform registry API — canonical event validation (M09)

**Status:** Live in gateway (SDK key)  
**Registry source:** `jurexio-specs/registry/events.json` (v1 adopted)

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/jrx/platform/registry/meta` | Version, alias policy, FLAG-012 count |
| GET | `/api/jrx/platform/registry/events/:name` | Lookup one event (404 if unknown) |
| POST | `/api/jrx/platform/registry/events/validate` | Body `{ "name": "MATTER.OPENED" }` — canonical / legacy-alias check |

**Auth:** `X-API-Key` (same as other `/api/jrx/sdk/*` platform routes).

## Validation codes

| Code | Meaning |
| --- | --- |
| `CANONICAL_EVENT` | Name is in registry and canonical |
| `LEGACY_ALIAS_ACCEPTED` | Legacy alias still within sunset window; includes `canonical` |
| `LEGACY_ALIAS_EXPIRED` | Alias past sunset — use `canonical` |
| `EVENT_NOT_IN_REGISTRY` | Reject at Ledger ingest (future) |

## Implementation

- Service: `src/services/jrx-module-registry-service.ts`  
- Routes: `src/routes/jrx-platform-registry-routes.ts`  
- CI: `tests/unit/jrx-module-registry-compliance.test.ts` + `jurexio-specs/registry/validate.py`
