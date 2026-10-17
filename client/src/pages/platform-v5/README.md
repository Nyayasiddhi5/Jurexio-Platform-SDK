# Platform-v5 Console pages

Task #109 (2026-05-11). Operator-facing admin pages for the nine
`/api/nv5/*` namespaces wired in Sessions 10–11 (Batches A–J). Each page
shares the same scaffolding from `_shared.tsx` and renders four panels:

1. **Feature-flag chips** — read from `GET /api/jrx/admin/feature-flags`
   (added in this task; backed by `getJrxFeatureFlagSnapshot()` in
   `src/config/jrx-feature-flags.ts`).
2. **Service inventory** — live HTTP probe of each sub-route's
   `/health` or `/capabilities` endpoint. A `404` chip means the
   per-sub-route flag is OFF — this is by design.
3. **Try-it form** — one happy-path action route per namespace. POST
   forms include a JSON body editor; results render in a code block.
4. **Audit chain** — last 25 entries from `/api/jrx/admin/audit` filtered
   to rows whose `resourceType` starts with the namespace prefix.

## UI → API map

| Page | Route | Underlying namespace | Batch | Flags (any-of) |
|------|-------|----------------------|-------|----------------|
| Orchestration | `/platform-v5/orch` | `/api/nv5/orch/*` | A | `JRX_F_AI_ORCH_*` (7) |
| Multimodal | `/platform-v5/multimodal` | `/api/nv5/multimodal/*` | B | `JRX_F_MULTIMODAL_*` (5) |
| Voice | `/platform-v5/voice` | `/api/nv5/voice/*` | B | `JRX_F_VOICE_*` (3) |
| Workflows | `/platform-v5/workflows` | `/api/nv5/workflows/*` | C | `JRX_F_WORKFLOW_*` (2) |
| Document AI | `/platform-v5/doc-ai` | `/api/nv5/doc-ai/*` | C | `JRX_F_DOC_AI_CONVERT` |
| Legal Pipeline | `/platform-v5/legal-pipeline` | `/api/nv5/legal-pipeline/*` | E | `JRX_F_LEGAL_PIPELINE_*` (5) |
| Compliance | `/platform-v5/compliance` | `/api/nv5/compliance/*` | F | `JRX_F_COMPLIANCE_*` (3) |
| Internal Services | `/platform-v5/internal` | `/api/nv5/internal/*` | G+H+I+J | `JRX_F_INTERNAL_SURFACE` |
| Governance | `/platform-v5/gov` | `/api/nv5/gov/*` | D | `JRX_F_GOV_*` (5) |

The dedicated full operator dashboard for governance lives at
`/superadmin/governance` (Batch D, 2026-05-10 — kept untouched). The
Platform-v5 governance page is a consistency surface so all 9 namespaces
share the same UX.

## Auth model

All page traffic flows through a single helper (`nv5Headers()` in
`_shared.tsx`) that mirrors the canonical Console request shape used by
`apiRequest` in `client/src/lib/queryClient.ts`:

- `Authorization: Bearer <jwt>` — read from `localStorage['token']`,
  identical to every other Console admin page.
- `X-API-Key: <admin sdk key>` — the canonical SDK auth header per
  NV-AUTH-HEADER-001, server-side extracted by `extractSdkApiKey` from
  `src/middleware/jrx-sdk-auth-header.ts`. Sourced from
  `localStorage['nyv.admin.sdkKey']`, set via the "Admin SDK key" panel
  rendered at the top of every page (mirrors the same operator workflow
  used by `/sdk-hub?tab=tester` and `/sdk-api-playground` — the Console
  intentionally does not auto-inject a shared admin secret).

**Steady-state expectation:** with the admin key configured AND the
namespace flag(s) ON, every probe returns `live · 200` and the try-it
form returns real namespace data. `401 / 403 / 404` are operator-
correctable conditions surfaced explicitly by the StateChip — they are
not the intended steady state.

Endpoint-by-endpoint:

- `/api/jrx/admin/feature-flags` and `/api/jrx/admin/audit` accept Console
  JWT (`super_admin` / `admin` / `org_admin`). The feature-flags
  endpoint also calls `extractSdkApiKey` for audit visibility — flag
  values are non-secret booleans, so we intentionally don't gate-by-
  SDK-key only.
- `/api/nv5/*` sub-routes require the admin-scoped X-API-Key. Without
  it, the StateChip shows `unauth · 401` or `no admin scope · 403` and
  the in-card hint points the operator at the SDK key panel.
- All routes are wrapped in `<ProtectedRoute minRole="super_admin">`.

## Out of scope

Productivity / downstream-platform UIs (NSP / Mitra / NSPM / NSI / NSA /
NSM / JRX live in their own clients per the Console-scope rule in
`replit.md`). These pages are ecosystem / AI-ops / governance only.
