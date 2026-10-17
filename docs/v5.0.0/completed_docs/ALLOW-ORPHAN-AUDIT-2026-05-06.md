---
status: COMPLETED
completed_at: 2026-05-06 (Session 7)
moved_to_completed_at: 2026-05-06T19:00Z
follow_up_doc: docs/v5.0.0/GO-LIVE-STATUS-2026-05-06.md
---

# ALLOW_ORPHAN audit — 2026-05-06

Status doc for `scripts/dashboard-route-lint.sh` ALLOW_ORPHAN list.
Each route has a verdict: **keep** (intentionally not in sidebar),
**sidebar-it** (should be added to NyvSidebar), or **delete** (route
should be removed).

Last reviewed: 2026-05-06.
Reviewer: T012 Stream C.

| Route | Category | Verdict | Notes |
| --- | --- | --- | --- |
| `/` | Framework | keep | Root → `/console/` redirect. |
| `/home` | Framework | keep | Legacy alias for landing. |
| `/login` | Framework | keep | Auth chrome — never in sidebar. |
| `/admin` | Framework | keep | Alias for `/command-centre`. |
| `/command-centre` | Framework | keep | Already in sidebar (Command Center → Overview). The lint allow-list entry is defensive. |
| `/admin-console` | Framework | keep | Alias for `<CommandCentre>`. |
| `/enterprise-dashboard` | Deferred | delete | T001 already removed `unified-enterprise-dashboard`; this route is now a 404 stub. Drop after one deploy. |
| `/realtime-dashboard` | Deferred | delete | Replaced by `/live-activity-feed` (Phase C). Pending route deletion in App.tsx. |
| `/digital-twin` | Super-admin | keep | `super_admin` only; sidebar entry would leak feature to lesser roles. |
| `/digital-twin-creator` | Super-admin | keep | Sub-route of digital-twin. |
| `/architect` | Manager | sidebar-it | Add to AI Operations → "Workflow Architect" in next sidebar pass. |
| `/institutional` | Platform-shell | keep | NSI admin-only; surfaced via NSI portal, not Console sidebar. |
| `/academy` | Platform-shell | keep | NSA admin-only. |
| `/ministry` | Platform-shell | keep | NSM admin-only. |
| `/lrm-dashboard` | Sub-route | keep | Deep-link from LLM Priority Router (already in sidebar). |
| `/superagent` | Operator | sidebar-it | Add to AI Operations → "Super Agent". |
| `/superadmin/overview` | Super-admin | sidebar-it | Add a "Super Admin" subsection to sidebar for super_admin role. |
| `/dashboard` | Legacy | delete | Old generic dashboard, no longer linked. |
| `/governance` | Legacy | delete | Replaced by Governance section in sidebar. |
| `/workspace` | Legacy | delete | Workspace consolidated under `/chat`. |
| `/workspace/:id` | Legacy | delete | Same as above. |
| `/global-chat` | Legacy | delete | Subsumed by `/chat`. |
| `/org-admin` | Consolidation | keep | Surfaced via Team & RBAC. |
| `/org-admin-dashboard` | Consolidation | keep | Alias of `/org-admin`. |
| `/user-profile` | Footer | keep | Reachable via sidebar footer button. |
| `/user/profile` | Footer | keep | Canonical profile path. |
| `/platform-config` | Sub-route | keep | Deep-link from Platform Settings. |
| `/org-platform-settings` | Sub-route | keep | Deep-link. |
| `/clawdbot-console` | Module deep-link | keep | Parent `/clawdbot` is in sidebar. |
| `/openbot-studio` | Module deep-link | keep | Parent `/openbot` is in sidebar. |
| `/automateai-builder` | Module deep-link | keep | Parent `/automateai` is in sidebar. |
| `/automation` | Module deep-link | keep | AutomateAI alternate path. |
| `/agents` | Sub-route | keep | Alias of `/agent-registry`. |
| `/agent-activity` | Sub-route | sidebar-it | Add under AI Operations → "Agent Activity". |
| `/agent-flows` | Sub-route | keep | Deep-link from Orchestration. |
| `/agent-live-testing` | Sub-route | keep | Deep-link from Agent Wizard. |
| `/agent-scorecard` | Sub-route | sidebar-it | Add under Governance → "Agent Scorecard". |
| `/agent-testing` | Sub-route | keep | Deep-link. |
| `/create-agent` | Sub-route | keep | Alias of `/agent-wizard`. |
| `/adversarial-testing` | Sub-route | keep | Alias of Governance → Adversarial Testing. |
| `/orchestration/a2a` | Sub-route | keep | Deep-link from Orchestration. |
| `/orchestration/bmad` | Sub-route | keep | Same. |
| `/orchestration/cam` | Sub-route | keep | Same. |
| `/orchestration/memory` | Sub-route | keep | Same. |
| `/orchestration/policies` | Sub-route | keep | Same. |
| `/orchestration/router-decisions` | Sub-route | keep | Same. |
| `/orchestration-dashboard` | Sub-route | keep | Legacy alias. |
| `/orchestration/lineage/:requestId` | Sub-route | keep | Drill-in from Router Decisions. |
| `/intelligence` | Sub-route | keep | Alias of `/intelligence/dashboard`. |
| `/legal-ner` | Sub-route | keep | Deep-link from Intelligence → Classify. |
| `/ner-explorer` | Sub-route | keep | Same. |
| `/multimodal` | Sub-route | sidebar-it | Add under AI Operations → "Multimodal Studio". |
| `/identity-extraction` | Sub-route | keep | Deep-link from Document AI Hub. |
| `/forensics` | Sub-route | keep | Alias of `/document-forensics`. |
| `/compliance/eu-ai-act` | Sub-route | keep | Alias of `/eu-ai-compliance`. |
| `/enforcement` | Sub-route | keep | Deep-link from Regulatory Monitor. |
| `/hash-chain` | Sub-route | keep | Alias of `/audit-chain`. |
| `/decision-cards` | Sub-route | keep | Alias of `/hitl-decision-cards`. |
| `/model-drift` | Sub-route | keep | Alias of `/drift-monitor`. |
| `/sdk-onboarding` | Sub-route | keep | Alias of `/sdk/onboarding`. |
| `/sdk-playground-v2` | Sub-route | delete | Superseded by `/sdk-playground`. |
| `/client-sdk-playground` | Sub-route | keep | Standalone client-SDK playground. |
| `/api-testing` | Sub-route | keep | Alias of `/sdk/api-tester`. |
| `/feature-test` | Sub-route | delete | Internal QA-only; remove from production routes. |
| `/sdlc` | Sub-route | keep | Deep-link from SDK Hub. |
| `/skills` | Sub-route | keep | Alias of `/skillshop`. |
| `/skills-marketplace` | Sub-route | keep | Same. |
| `/testing/llm-judge` | Sub-route | keep | Alias of `/llm-judge`. |
| `/testing/scorecard` | Sub-route | keep | Alias of `/agent-scorecard`. |
| `/test/p1-quality` | Sub-route | delete | One-shot QA path; remove. |
| `/p1-ai-quality` | Sub-route | delete | Same. |
| `/billing/ledger` | Sub-route | sidebar-it | Add under Ecosystem Mgmt → "Billing Ledger". |
| `/content-studio` | Sub-route | sidebar-it | Add under AI Operations → "Content Studio". |
| `/cost-optimization` | Sub-route | keep | Alias of `/cost-optimizer`. |

## Summary

| Verdict | Count |
| --- | --- |
| keep | 47 |
| sidebar-it | 9 |
| delete | 9 |

## Follow-up actions

1. **delete (9):** open a follow-up PR removing the 9 routes from `client/src/App.tsx` AND from the ALLOW_ORPHAN array.
2. **sidebar-it (9):** open a follow-up PR adding the 9 entries to `client/src/components/NyvSidebar.tsx` under the noted sections, then drop them from the ALLOW_ORPHAN array.
3. **keep (47):** retain in the allow-list; this audit is the canonical justification.
