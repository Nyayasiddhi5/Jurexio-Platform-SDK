# Access-decision interface — CommandCentre (M11)

**Status:** Sprint 1 v1 policy engine — 23 Oct 2026  
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

### Response (Sprint 1 v1)

- HTTP 200 with `decision`, `code`, `message`, optional `gateClass`.
- Deny codes include `PERMISSION_UNKNOWN`, `MATTER_POLICY_REQUIRED`, `STEP_UP_REQUIRED`, `SOD_*`, `ROLE_ASSIGNMENTS_NOT_WIRED`, `PERMISSION_NOT_HELD`.
- Allow when `context.heldPermissions` includes the permission and gate/SoD checks pass.
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
- Implementation: `src/services/jrx-access-policy-service.ts`, `src/routes/jrx-platform-access-routes.ts`
