---
status: live
version: 5.0.1 (current platform train); SDK suite v5.0.0 frozen until next major
internal_platform_version: 5.0.1 (per package.json + NYV_PLATFORM_VERSION)
dev_test_live_milestone: 2026-05-03 (consumer-app cutover) + 2026-05-06 Session 7 closure
production_ga: 2026-05-15 (per Project-Tracker §1 master schedule)
last_updated: 2026-05-06
canonical_status_doc: GO-LIVE-STATUS-2026-05-06.md
---

> **2026-05-06 update (Session 7).** Eleven finished session audits have
> been moved to `./completed_docs/` with `status: COMPLETED` front-matter.
> The single read-this-first answer for "what's done / what's left to go
> live" is now [`GO-LIVE-STATUS-2026-05-06.md`](./GO-LIVE-STATUS-2026-05-06.md).

# Nyayavigya Platform v5.0.0 (GA cut) — Documentation Index

Welcome to the **v5.0.0 GA cut** of the Nyayavigya platform. This is the
documentation set the five Nyayasiddhi consumer platforms — **NyayaMitra
(NYM)**, **NyayaSiddhi Pro (NSP)**, **NyayaSiddhi Institutions (NSI)**,
**NyayaSiddhi Apex (NSA)**, and **NyayaSiddhi Ministries (NSM)** — should
read **before** they consume any SDK or call any gateway endpoint.

> **A note on versioning.** The public/consumer-facing version of the SDK
> suite is **v5.0.0**, and that is the version that appears in every
> `package.json` your apps install (`@nyayavigya/{client-sdk,client-sdk-react-native,nyayamitra-sdk,react-hooks,enterprise-sdk,types}@5.0.0`).
> The internal platform `package.json` stays at **3.1.2** until the next
> major-release merge per the freeze policy in
> [`Project-Tracker.md`](../../Project-Tracker.md) §1. Wherever this doc
> set says "Nyayavigya Platform v5.0.0" it means the **GA-cut release
> train** that includes the v5.0.0 SDK suite plus the EC2 dev gateway
> running platform code 3.1.2 with the May-3 fixes applied.

## What's in this folder

| Doc | Audience | Read first when… |
|-----|----------|-------------------|
| [`GO-LIVE-STATUS-2026-05-06.md`](./GO-LIVE-STATUS-2026-05-06.md) | **Everyone** — platform owner, ops, downstream platform teams | You need the canonical "what works / what's left" answer for the May-15 GA. SDK / API / Dashboard / AI status + 18-item pending list with owners + effort. |
| [`NYV-PRODUCT-NOTE-BUSINESS-v5.0.0.md`](./NYV-PRODUCT-NOTE-BUSINESS-v5.0.0.md) | Product owners, business owners, partner CXOs, sales engineers | You need to explain *what* the platform does, *why* it wins, and *which* feature lands where — without ever touching code. |
| [`NYV-PRODUCT-NOTE-TECHNICAL-v5.0.0.md`](./NYV-PRODUCT-NOTE-TECHNICAL-v5.0.0.md) | Architects, platform engineers, integrators on the 5 Nyayasiddhi platforms, SREs | You need to know *how* it's built, *which* route serves what, *which* table holds what, and *how* the SDKs wire into your app. (Read §0a first for the v5.0.1 / Session 7 delta.) |
| [`SCALE-10M-READINESS-2026-05-06.md`](./SCALE-10M-READINESS-2026-05-06.md) | Architects, SREs | Pre-EC2-deploy scale plan for 10M-row scenarios. |
| [`SCHEMA-OWNERSHIP-2026-05-06.md`](./SCHEMA-OWNERSHIP-2026-05-06.md) | Architects, ENG | Single map of all 87 schema tables grouped by 10 domains. |
| [`NYV-REPLIT-API-CHEATSHEET.md`](./NYV-REPLIT-API-CHEATSHEET.md) | All ENG | Copy-paste curls for the most-used Replit-served endpoints. |
| [`completed_docs/`](./completed_docs/) | History | 11 finished session audits (SESSION-7, NAVIGATION, PLAN-VS-REALITY, T004-MOCK-DATA, AI-COHESIVENESS, ALLOW-ORPHAN, DOC-MGMT-PHASE2, DOCUMENT-MANAGEMENT, NYV-AUDIT-REPORT, V5-PLAN-WORKSTREAMS, V5-READINESS). |

## What stays valid from v3.1.2

The v5.0.0 GA cut **inherits** these v3.1.2 documents unchanged. They are
authoritative for v5.0.0 unless explicitly superseded by something in this
folder:

| Doc | Why it still applies in v5.0.0 |
|-----|------------------------------|
| [`../v3.1.2/completed_docs/architecture/NYV-ARCHITECTURE-CANONICAL.md`](../v3.1.2/completed_docs/architecture/NYV-ARCHITECTURE-CANONICAL.md) | Single source of truth for system architecture (gateway, orchestration, RAG, memory, datastores). v5.0.0 added no new architectural layers. |
| [`../v3.1.2/completed_docs/architecture/NYV-TECH-SPEC-MASTER.md`](../v3.1.2/completed_docs/architecture/NYV-TECH-SPEC-MASTER.md) | Developer onramp — every src/ subdirectory, boot sequence, fragility map. Still current. |
| [`../v3.1.2/completed_docs/agents/NYV-AGENT-CATALOG.md`](../v3.1.2/completed_docs/agents/NYV-AGENT-CATALOG.md) | The 148-specialist + 1-Queen agent catalogue per jurisdiction. v5.0.0 ships the same registry. |
| [`../v3.1.2/completed_docs/agents/agents-product.md`](../v3.1.2/completed_docs/agents/agents-product.md) | Per-agent product description (973 lines). v5.0.0 inherits unchanged. |
| [`../v3.1.2/completed_docs/NYV-SDK-v5-MASTER-INTEGRATION-GUIDE.md`](../v3.1.2/completed_docs/NYV-SDK-v5-MASTER-INTEGRATION-GUIDE.md) | SDK v5 master guide — covers all 6 packages. v5.0.0 IS this version. |
| [`../v3.1.2/completed_docs/NYV-SDK-v5-INTEGRATION-GUIDE.md`](../v3.1.2/completed_docs/NYV-SDK-v5-INTEGRATION-GUIDE.md) | SDK v5 integration patterns. Current. |
| [`../v3.1.2/completed_docs/NYV-SDK-v5-API-REFERENCE.md`](../v3.1.2/completed_docs/NYV-SDK-v5-API-REFERENCE.md) | SDK v5 API reference. Current. |
| [`../v3.1.2/completed_docs/NYV-OBSERVABILITY.md`](../v3.1.2/completed_docs/NYV-OBSERVABILITY.md) | Logs / metrics / tracing — unchanged. |
| [`../v3.1.2/completed_docs/NYV-INCIDENT-RUNBOOK.md`](../v3.1.2/completed_docs/NYV-INCIDENT-RUNBOOK.md) | Incident runbook — unchanged. |
| [`../v3.1.2/completed_docs/NYV-COMPLIANCE-ATTESTATION.md`](../v3.1.2/completed_docs/NYV-COMPLIANCE-ATTESTATION.md) | DPDP / GDPR posture — unchanged. |
| [`../v3.1.2/completed_docs/NYV-DR-DRILL-RESULTS.md`](../v3.1.2/completed_docs/NYV-DR-DRILL-RESULTS.md) | DR drill outcomes — unchanged. |
| [`../v3.1.2/completed_docs/NYV-PARTNER-DEPLOY-GUIDE.md`](../v3.1.2/completed_docs/NYV-PARTNER-DEPLOY-GUIDE.md) | Partner self-host guide. Current. |
| [`../v3.1.2/completed_docs/NYV-Production-Use-Cases-India.md`](../v3.1.2/completed_docs/NYV-Production-Use-Cases-India.md) | India-specific use cases. Current. |
| [`../v3.1.2/completed_docs/NYV-CICD-REPLIT.md`](../v3.1.2/completed_docs/NYV-CICD-REPLIT.md) | CI/CD doc — but see the SSM-deploy delta in [`PRE-GA-STATUS-2026-05-03.md`](../v3.1.2/PRE-GA-STATUS-2026-05-03.md) §4. |
| [`../v3.1.2/SDK-DEV-EC2-ACCESS-2026-05-01.md`](../v3.1.2/SDK-DEV-EC2-ACCESS-2026-05-01.md) | Live EC2 dev access with §11 caveats marked RESOLVED. |
| [`../v3.1.2/SDK-RELEASE-2026-05-03.md`](../v3.1.2/SDK-RELEASE-2026-05-03.md) | Per-platform hand-off (NYM/NSP/NSI/NSA/NSM). |
| [`../v3.1.2/PRE-GA-STATUS-2026-05-03.md`](../v3.1.2/PRE-GA-STATUS-2026-05-03.md) | Live pre-GA status with R1–R5 (Replit) + E1–E5 (EC2) pending items. |

## What's superseded by v5.0.0

| Old doc                                                                                                   | Replaced by                                              |
|-----------------------------------------------------------------------------------------------------------|----------------------------------------------------------|
| [`../v3.1.2/completed_docs/NYV-PRODUCT-NOTE-BUSINESS-v3.1.2.md`](../v3.1.2/completed_docs/NYV-PRODUCT-NOTE-BUSINESS-v3.1.2.md) | [`NYV-PRODUCT-NOTE-BUSINESS-v5.0.0.md`](./NYV-PRODUCT-NOTE-BUSINESS-v5.0.0.md) |
| [`../v3.1.2/completed_docs/NYV-PRODUCT-NOTE-TECHNICAL-v3.1.2.md`](../v3.1.2/completed_docs/NYV-PRODUCT-NOTE-TECHNICAL-v3.1.2.md) | [`NYV-PRODUCT-NOTE-TECHNICAL-v5.0.0.md`](./NYV-PRODUCT-NOTE-TECHNICAL-v5.0.0.md) |

The v3.1.2 versions remain in their original folder for history; they should
not be linked from any new partner-facing material.

## Where to start, by role

- **CXO / business owner** → `NYV-PRODUCT-NOTE-BUSINESS-v5.0.0.md` §1, §3, §9.
- **Product manager** → `NYV-PRODUCT-NOTE-BUSINESS-v5.0.0.md` §4 (capabilities) + §7 (user journeys).
- **Solution architect** → `NYV-PRODUCT-NOTE-TECHNICAL-v5.0.0.md` §3 (ecosystem wiring) + §21 (deployment topology).
- **Integrator (NYM/NSP/NSI/NSA/NSM)** → `../v3.1.2/SDK-RELEASE-2026-05-03.md` first, then `NYV-PRODUCT-NOTE-TECHNICAL-v5.0.0.md` §22 (SDK suite).
- **SRE** → `NYV-PRODUCT-NOTE-TECHNICAL-v5.0.0.md` §21 (deployment) + §23 (CI/CD reality) + `../v3.1.2/PRE-GA-STATUS-2026-05-03.md` E1–E5.
