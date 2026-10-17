# NV Wiring Closure Report (2026-05-29)

## Scope

This closure pass addresses:

1. The 5 effective orphan findings from the fresh wiring audit.
2. Feature-registry/readiness reconciliation to current audit truth.
3. Verification that bots/chat/digital twin/governance/compliance/security surfaces are wired across gateway, SDK, and console.

## Before -> After (Audit Evidence)

### Before (pre-fix snapshot captured during this pass)

- `npm run audit:wiring` (pre-fix) reported middleware/service false orphans including:
  - `src/services/audit-chain-lock.ts`
  - `src/middleware/nv-auth.ts`
  - `src/middleware/nv-sdk-auth-header.ts`
  - `src/middleware/nv-sdk-tracking-middleware.ts`
  - `src/middleware/nv-usage-metering-middleware.ts`
- `npm run guardrail:no-new-orphans` reported `effective orphans: 1 / budget 1` after first resolver fix, with the last remaining effective orphan being `nv-usage-metering-middleware`.

### Fixes Applied

1. **Audit resolver correction** in `scripts/nv-wiring-audit.ts`
   - Import resolution now prefers source `.ts/.tsx` targets before sibling runtime `.js` artifacts.
   - This removes false-negative reachability when TS files import `*.js` for ESM runtime.
2. **Runtime wiring closure** in `src/index.ts`
   - Replaced dynamic usage-metering import with static import and mount:
     - `import { nvUsageMetering } from './middleware/nv-usage-metering-middleware.js'`
     - `app.use('/api/nv/', nvUsageMetering)`

### After (post-fix snapshot)

- `npm run audit:wiring`:
  - `wired: 334`
  - `usedInternal: 83`
  - `orphan: 24` (intentional allowlisted only)
- `npm run guardrail:no-new-orphans`:
  - `effective orphans: 0 / budget 1`
  - `allowlisted: 24 of 24 raw`

Conclusion: **100% effective-orphan closure achieved** (0 effective orphans).

## Feature Wiring Verification (Requested Domains)

### 1) Bots + Chat + Digital Twin

- **Gateway mounts** (in `src/index.ts`):
  - Bots: `/api/nv/clawdbot`, `/api/nv/openbot`, `/api/nv/automateai`, `/api/nv/twindesk`
  - Chat: `/api/nv/legal-chat`, `/api/nv/stream` (AG-UI), `/api` universal chat router
  - Digital twin: `/api/nv/digital-twin`
- **Route implementations**:
  - Bots: `src/routes/nv-{clawdbot,openbot,automateai,twindesk}-routes.ts`
  - Chat: `src/routes/nv-legal-chat-routes.ts`, `src/routes/nv-universal-chat-routes.ts`, `src/routes/nv-agui-stream-routes.ts`
  - Digital twin: `src/routes/nv-digital-twin-routes.ts` (create/list/read/event/simulate/ack/archive/meta)
- **Console routes** (`client/src/App.tsx`):
  - `/chat`, `/legal-chat`, `/universal-chat`, `/global-chat`
  - `/openbot`, `/automateai`, `/twindesk`, `/digital-twin`

### 2) Governance + Compliance + Security Controls

- **Governance surfaces**:
  - Aggregators mounted under `/api/nv` via `nv-governance-aggregators.ts`
  - Gov v5 namespace mounted at `/api/nv5/gov` via `src/routes/nv5/gov/index.ts`
- **Compliance/security surfaces**:
  - `/api/nv/compliance` (`nv-compliance-routes.ts`) includes:
    - SOC2 evidence (`/soc2/evidence`)
    - ISO 42001 score in dashboard payload
    - DPDPA status/reference in dashboard payload
    - EU AI Act classifications + gap analysis
  - Additional compliance/security routes:
    - `src/routes/nv-iso-compliance-routes.ts`
    - `src/routes/nv-bipa-consent-routes.ts`
    - `src/routes/nv-governance-posture-routes.ts`
    - `src/routes/nv-policies-routes.ts`
  - Security monitor remains feature-flag gated in `src/index.ts` (`securityMonitor` / `govSecurityMon`).

### 3) SDK/API Surface Coverage

- **Client SDK exports** (`packages/client-sdk/src/index.ts`):
  - `ComplianceApi`, `ComplianceNv5Api`, `GovApi`, `OrchApi`, `DocAiApi`, `LegalPipelineApi`, `TwinApi`, `IntelligenceApi`, `VoiceApi`, `AgentsApi`, `WorkflowsApi`, etc.
- **SDK client wiring** (`packages/client-sdk/src/NyvClient.ts`):
  - Instantiates `compliance`, `complianceNv5`, `gov`, `orch`, `docAi`, `legalPipeline`, `twins`, `intelligence`, `voice`, `agents`, `workflows`.

### 4) Dashboard / Command Centre Management

- **Command/admin aliases** (`client/src/App.tsx`):
  - `/command-centre`, `/admin`, `/admin-console` are routed into the unified dashboard surface.
- **Governance/compliance UI entries**:
  - `/governance`, `/governance-surface`, `/compliance/eu-ai-act`
- **Agent/admin surfaces**:
  - `/agent-registry`, `/agents` alias

## Registry + Readiness Reconciliation Completed

- Updated `FEATURES-REGISTRY.md` headline wiring counts to current audit truth (`wired=334`, `usedInternal=83`, `effective orphan=0`).
- Updated `documents/working/READINESS-MATRIX-v5.1.0.md` with a dedicated 2026-05-29 wiring closure block and exact command evidence.

## Final Verdict

- Effective orphan closure: **COMPLETE (0 effective orphans)**.
- Wiring-audit truth/docs reconciliation: **COMPLETE**.
- Bots/chat/digital twin/governance/compliance/security/ISO42001/DPDPA/SOC2 surfaces are **present and wired** at code level across gateway routes, SDK surface, and dashboard routes.
- Remaining runtime-proof work (separate from wiring closure): full end-to-end UAT execution depends on a running gateway + database + provider credentials.
