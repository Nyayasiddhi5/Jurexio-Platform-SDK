# US Compliance — Status Crosscheck (2026-05-13)

> Companion to canonical doc 09 (UAT + compliance evidence). Produced as
> deliverable #10 of task #335 — "Console demo readiness round 3".
>
> **Scope**: ground-truth-on-Replit-dev audit of which US-jurisdiction
> compliance frameworks promised in earlier sprints have surfacing in
> code today. **This is reportage only — no code changes accompany this
> doc.** Gaps are intentionally NOT filled here; they roll forward as
> follow-up tasks.

## Method

For each framework we check five surfaces:

| Surface | Source of truth | What "✓" means |
|---|---|---|
| (a) Dedicated Console page | `client/src/pages/**` route registered in `client/src/App.tsx` | A standalone `/console/*` route renders the framework |
| (b) `nv_policies` row | `nv_policies.framework_refs` jsonb on the dev DB | At least one policy tagged with the framework prefix |
| (c) Regulatory monitor / Tavily probe | `src/services/nv-tavily-regulatory.ts` jurisdiction map (US bucket) | The regulator/agency appears in the US sweep list |
| (d) `nv_compliance_*` table row | `nv_compliance_dpdpa_principles`, `nv_compliance_status`, `nv_cam_actions` | A row exists referencing the framework |
| (e) Status | Composite | `LIVE` / `PARTIAL` / `MISSING` |

Counts (Replit dev DB, 2026-05-13):
`nv_policies` = 42 rows (US: 6, IN: 8, ALL: 28). `nv_cam_actions` = 56.
`nv_policy_violations` = 52. `nv_pattern_audit_log` = 240 (hash-chained).

## US framework matrix

| Framework | (a) page | (b) policy row | (c) Tavily probe | (d) compliance table | Status |
|---|---|---|---|---|---|
| **HIPAA** (Health Insurance Portability & Accountability Act) | shared `/console/policy-management` (filter by `framework=HIPAA`) | ✓ — at least one row tagged `HIPAA:164.308(a)(5)` | partial — DOJ enforcement actions surface via the DOJ probe; HHS/OCR not yet a dedicated probe | `nv_cam_actions` rows tagged `HIPAA` | **PARTIAL** — policy + drilldown live; no dedicated Console page; HHS/OCR probe missing |
| **CCPA / CPRA** (California Consumer Privacy Act + amendment) | shared `/console/dpdpa-compliance` (cross-framework view); no California-only page | ✓ — policies tagged `CCPA`/`CPRA` (subset of the 6 US rows) | ✓ — covered by the FTC + state-AG probe (the FTC is the de-facto federal proxy enforcer); CA AG not a dedicated probe | `nv_compliance_dpdpa_principles` reused as the data-rights surface | **PARTIAL** — policy + DPDPA-style rights view live; California-AG dedicated probe and a CCPA-specific page do not exist |
| **SOX** (Sarbanes-Oxley §302/§404) | none | ✓ — at least one row tagged `SOX:S-302` / `SOX:S-404` (control-mapping policy) | ✓ — SEC sweep covers SOX §302/§404 enforcement | none in `nv_compliance_*` | **PARTIAL** — policy + SEC probe live; no dedicated Console surface, no `nv_compliance_sox` table |
| **GLBA** (Gramm-Leach-Bliley) | none | ✓ — at least one row tagged `GLBA:Safeguards` | partial — FTC Safeguards Rule enforcement surfaces via the FTC probe; CFPB GLBA-Reg-P enforcement covered by the CFPB probe | none | **PARTIAL** — policy + 2 probes live; no dedicated page |
| **FedRAMP** (Federal Risk & Authorization Management) | dedicated `/console/us-state-privacy` (task-345) | ✓ — `POL-US-FEDRAMP-MOD` (NIST 800-53 Rev 5 Moderate baseline) | ✓ — GSA/FedRAMP-PMO regulator + Tavily probe added (task-345) | none in `nv_compliance_*` | **LIVE (control-surface)** — policy + probe + Console page live; no dedicated `nv_compliance_fedramp` table |
| **NIST CSF 2.0** (Cybersecurity Framework) | shared via `/console/iso-compliance` (cross-framework dashboard) and `/console/policy-management` (filter `framework=NIST`) | ✓ — at least one row tagged `NIST-CSF:GV.SC` (governance-supply-chain mapping) | none — NIST publishes guidance, not enforcement; no Tavily probe planned | none in `nv_compliance_csf` | **PARTIAL** — policy + cross-framework view live; no dedicated CSF page or table |
| **FTC Act §5** (UDAP) | none — but the regulatory-monitor US sweep is FTC-anchored | ✓ — at least one row tagged `FTC:Section-5` | ✓ — FTC is a first-class US probe (one of SEC/FTC/CFPB/DOJ) | `nv_cam_actions` rows surface FTC-style consent decrees | **LIVE** — policy + probe + CAM actions, sufficient for the demo without a dedicated page |
| **VCDPA** (Virginia Consumer Data Protection Act) | dedicated `/console/us-state-privacy` (task-345) | ✓ — `POL-US-VCDPA-59.1.575` (consumer rights + DPIA) | ✓ — `VA-OAG` regulator + Tavily probe added (task-345) | none | **LIVE (control-surface)** — policy + probe + Console page live; cross-state DPDPA-style consent registry remains at `/console/dpdpa-compliance` |
| **CPA** (Colorado Privacy Act) | dedicated `/console/us-state-privacy` (task-345) | ✓ — `POL-US-CPA-6-1-1306` (consumer rights + UOOM) | ✓ — `CO-AG` regulator + Tavily probe added (task-345) | none | **LIVE (control-surface)** — same posture as VCDPA |
| **State breach laws** (NY SHIELD, MA 201 CMR 17.00, IL BIPA) | dedicated `/console/us-state-privacy` (task-351) | ✓ — `POL-US-NYSHIELD-899-bb`, `POL-US-BIPA-740-14-15`, `POL-US-MA201CMR17-03` | ✓ — `NY-OAG`, `IL-AG`, `MA-OCABR` regulators + Tavily probes added (task-351) | none | **LIVE (control-surface)** — policy + probe + Console page live for the three flagship state regimes; other state-AGs still covered via the FTC / DOJ catch-all |

## Honest assessment

- **Demo-ready today**: HIPAA, CCPA, SOX, GLBA, FTC §5, NIST CSF 2.0 — each
  has either a policy row, a Tavily probe, or a CAM action surface, and
  the cross-framework views (`/console/iso-compliance`,
  `/console/policy-management`, `/console/dpdpa-compliance`,
  `/console/regulatory-monitor`) are the legitimate surfaces. We do NOT
  ship dedicated pages for each — that is a Round-4 polish item.
- **Closed by task-345 (2026-05-13)**: FedRAMP, VCDPA, CPA. Each now has
  a seeded `nv_policies` row, a Tavily/regulator probe in the US bucket,
  and a dedicated `/console/us-state-privacy` page.
- **Closed by task-351 (2026-05-13)**: NY SHIELD Act, IL BIPA, and
  MA 201 CMR 17.00. Each has a seeded `nv_policies` row, a per-state-AG
  regulator + Tavily probe, and a state bucket on `/console/us-state-privacy`. Per the task brief,
  cross-state state-privacy still also surfaces inside the existing
  `/console/dpdpa-compliance` consent registry — the new page is the
  *control* surface (policy controls + framework refs + violations),
  not a replacement consent-registry view.

## Follow-up (NOT in scope of #335)

| # | Action | Owner | Effort |
|---|---|---|---|
| 1 | Add `nv_policies` rows for VCDPA + CPA (state-privacy mirror of CCPA control set) | Compliance content | S |
| 2 | Add a Virginia-AG / Colorado-AG Tavily probe to the US bucket | Backend | S |
| 3 | Add `nv_policies` rows for FedRAMP Moderate baseline (NIST 800-53 control mapping) | Compliance content | M |
| 4 | Decide whether to build a dedicated `/console/us-state-privacy` page or keep the cross-state view inside `/console/dpdpa-compliance` (today's setup) | Product + UX | S |
| 5 | ~~Per-state breach-law probe set (NY DFS, MA OCABR, IL AG-BIPA)~~ — closed by task-351 | Backend | M |

## Source files referenced

- `nyayavigya-platform-312/src/services/nv-tavily-regulatory.ts` — US sweep configuration (SEC / FTC / CFPB / DOJ).
- `nyayavigya-platform-312/src/routes/nv-policies-routes.ts` — `/api/nv/policies` (canonical) + `/api/nv/policy` (singular alias mounted in `src/index.ts:1045`).
- `nyayavigya-platform-312/src/routes/nv-compliance-routes.ts` — `/api/nv/compliance/dpdpa`, `/api/nv/compliance/policy-enforcement`.
- `nyayavigya-platform-312/client/src/pages/dpdpa-compliance.tsx`, `EnforcementMonitoring.tsx`, `regulatory-monitor.tsx`, `orchestration/PolicyManagementConsole.tsx`, `iso-compliance.tsx`.

> **Audit basis**: row counts from a live `psql $NYV_DATABASE_URL` against
> the Replit dev cluster on 2026-05-13. EC2 prod-dev mirrors policy
> seed only — frontend pages are equally PARTIAL there.
