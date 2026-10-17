# Monorepo — Where to Edit (NYV vs NYS)

> **Updated:** 2026-09-02  
> **Audience:** Cursor agents, Replit agents, human collaborators

This workspace contains **two products** deployed to **two EC2 instances**. Always classify **NYV / NYS / BOTH** before editing.

| Tag | Tree | EC2 | Primary URL |
|---|---|---|---|
| **NYV** | `nyayavigya-platform-312/` | nysdev `i-0df71e5ea1df8f588` | `console.nyayasiddhi.online` / gateway API |
| **NYS** | `NYS-Agentic-AI/` | caselaw-worker `i-000115b19219bb766` | `nyayasearch.nyayasiddhi.online` |

## NYV (Nyayavigya Platform)

- **Gateway + Console:** `src/`, `client/`
- **Deploy script:** `scripts/deploy-aws-ssm.sh`
- **Guardrails:** `guardrails.md`, parent `AGENTS.md`
- **Feature registry:** `FEATURES-REGISTRY.md`
- **API path SSoT:** `client/src/lib/nv-api-paths.ts`
- **Console route map:** `documents/working/CONSOLE-DASHBOARD-ROUTE-API-MAP-2026-08-23.md`

### Common NYV tasks

| Task | Where |
|---|---|
| Sidebar / Console routes | `client/src/App.tsx`, `client/src/components/NyvSidebar.tsx` |
| Hub tabs | `client/src/pages/hubs/*Hub.tsx` |
| Super-admin surfaces | `client/src/pages/superadmin-*.tsx`, `client/src/components/admin/` |
| Gateway routes | `src/index.ts`, `src/routes/nv-*.ts` |
| Partner SDK | `packages/*`, `src/routes/nv-sdk-*` |

## NYS (NyayaSearch / Agentic AI)

- **Own git:** nested `.git` under `NYS-Agentic-AI/`
- **Deploy:** separate pipeline to caselaw-worker — see `NYS-Agentic-AI/replit.md`
- **Do not** mix NYV gateway changes into NYS tree or vice versa

## Credentials (demo session)

Keys live on **nysdev EC2** — do not re-fetch from SSM. See parent `documents/working/DEMO-SESSION-CREDENTIALS-2026-08.md` and rule NV-DEMO-SESSION-001.

## Preflight before NYV work

```bash
npm run session:preflight
```

## Guardrail before declaring done

```bash
npm run guardrail
```
