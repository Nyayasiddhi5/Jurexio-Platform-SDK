# Access-decision interface — CommandCentre (M11)

**Status:** v1 spec + deny-default stub — 25 Oct 2026  
**Host:** CommandCentre (M11)  
**Policy data:** MatterCore (M01) and ClientBridge (M08) supply matter state, walls, and location context

## Endpoint

`POST /api/jrx/platform/access/evaluate`

**Auth:** SDK API key (`X-API-Key`) via `sdkGatewayAuth`.

### Request (JSON)

| Field | Required | Description |
| --- | --- | --- |
| `permission` | Yes | Permission catalogue ID (e.g. `matter.open.approve`) |
| `subjectId` | Yes | Person or service principal |
| `resourceId` | No | Matter, document, or unit ID |
| `context` | No | Matter state, jurisdiction, wall tokens (future) |

### Response (current stub)

- HTTP 200 with `decision: "deny"`, `code: "ACCESS_POLICY_NOT_WIRED"` until policy engine ships.
- HTTP 400 if `permission` or `subjectId` missing.

## Decision algorithm (target Sprint 1)

1. Deny if permission unknown in `permissions.json`.
2. Evaluate role templates + scoped assignments + `separation-of-duties.json`.
3. Apply gate class rules (GUARDED / DUAL / SELF_ATTESTED) for `.decide` permissions.
4. Enforce `protected` + `step_up_required` via credential verification gate (G-11-05).
5. Default **deny**.

## References

- `jurexio-specs/registry/permissions.json` @ 1.0.0-adopted  
- `jurexio-specs/registry/role-templates.json`  
- `jurexio-specs/registry/separation-of-duties.json`  
- Implementation stub: `src/routes/jrx-platform-access-routes.ts`
