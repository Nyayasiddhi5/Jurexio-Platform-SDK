---
status: live
last_updated: 2026-05-02
canonical_doc_count: 8
policy: see Project-Tracker.md §1 row "Doc policy (canonical 8-doc set)"
---

# Nyayavigya Platform — Documentation Index

From **2026-05-01** onward, all platform documentation collapses into
**exactly eight canonical files** that are updated in place. One-off,
per-day, or per-feature docs are forbidden. Any new feature, fix, or
plan must be folded into the right file below.

> **Rule:** never create a new top-level doc. Edit one of the eight.

---

## The eight canonical documents

| # | Document | Path | Audience | Status |
|---|---|---|---|---|
| 1 | **Business Product Note** | [`v5.0.0/NYV-PRODUCT-NOTE-BUSINESS-v5.0.0.md`](./v5.0.0/NYV-PRODUCT-NOTE-BUSINESS-v5.0.0.md) | CXO, PM, sales, partners | LIVE |
| 2 | **Technical Product Note** (architecture + algorithms + user flows + tech-stack) | [`v5.0.0/NYV-PRODUCT-NOTE-TECHNICAL-v5.0.0.md`](./v5.0.0/NYV-PRODUCT-NOTE-TECHNICAL-v5.0.0.md) | architects, platform engineers, integrators, SREs | LIVE |
| 3 | **Changelog** (per-day changes, ISO timestamps) | [`../Project-Tracker.md` §5](../Project-Tracker.md) | everyone | LIVE |
| 4 | **Project Tracker** (pinned facts + built-vs-pending matrix) | [`../Project-Tracker.md`](../Project-Tracker.md) | everyone — read first | LIVE |
| 5 | **Deployment Plan** (Replit↔EC2 sync, RDS/ElastiCache cutover, SDK release process, infra runbooks) | `NYV-DEPLOYMENT.md` | SRE, ops, release engineers | **TO BE CONSOLIDATED** — sources: `v3.1.2/PRE-GA-STATUS-2026-05-03.md`, `v3.1.2/SDK-RELEASE-2026-05-03.md`, `v3.1.2/SDK-DEV-EC2-ACCESS-2026-05-01.md`, `v3.1.2/RDS-ELASTICACHE-CUTOVER-RUNBOOK.md`, `v3.1.2/SDK-DOWNLOAD-ENDPOINT.md`, `v3.1.2/SDK-PLATFORM-*.md` |
| 6 | **Security, Compliance & Governance** (RBAC, IAM, multi-tenant, guardrails, DPDPA/EU-AI-Act/SOC2 posture, threat model) | `NYV-SECURITY-COMPLIANCE-GOVERNANCE.md` | security lead, compliance, auditors | **TO BE CONSOLIDATED** — sources: `v3.1.2/pending_implementation_docs/NYV-IAM-GAPS.md`, threat model output, RBAC spec |
| 7 | **Audit Document** (audit hash chain spec, observability, live audit gap reports, optimization audits) | `NYV-AUDIT.md` | auditors, SRE, internal QA | **TO BE CONSOLIDATED** — sources: `v3.1.2/NYV-LIVE-AUDIT-GAP-REPORT-2026-04-27.md`, `v3.1.2/NYV-SCHEMA-MIGRATION-CONFIRMATION-2026-04-27.md`, archived `NYV-OBSERVABILITY.md`, `NYV-OPTIMIZATION-AUDIT-2026-04-27.md` |
| 8 | **Data Architecture, Seeding, RAG & Memory Management** (DB schema, migrations, seeders, RAG content corpus + pipeline + authenticity contract, memory tiers L1–L5) | [`NYV-DATA-RAG-MEMORY.md`](./NYV-DATA-RAG-MEMORY.md) | data engineers, RAG owners, platform engineers | **PARTIAL** — RAG content-expansion action plan landed 2026-05-02; remaining sections (DB schema, memory tiers, seeders) to fold in next session |

---

## What changed on 2026-05-01

The previous fan-out doc model (per-feature snapshot files, dated status
docs, separate per-platform SDK guides, separate INDEX files) is
**deprecated**. Everything now lives in one of the eight files above and
is updated in place.

Files moved to `../archive/2026-05-01-doc-consolidation/`:
- `docs/PROJECT-TRACKER.md` (stale 21KB duplicate of root `Project-Tracker.md`)
- `docs/v3.1.2/PRE-GA-STATUS-2026-04-25.md` (superseded by 2026-05-03 status, which itself folds into doc 5 next)
- `docs/v3.1.2/INDEX.md` (replaced by this README)
- `docs/Docker-Bake-v5.0.0.md` (folds into doc 5)
- `docs/MCP-Reconciliation-v5.0.0.md` (folds into doc 8)
- `docs/NYV-OBSERVABILITY.md` (folds into doc 7)
- `docs/NYV-OPTIMIZATION-AUDIT-2026-04-27.md` (folds into doc 7)

The remaining `v3.1.2/` files (`PRE-GA-STATUS-2026-05-03.md`,
`SDK-RELEASE-2026-05-03.md`, `SDK-DEV-EC2-ACCESS-2026-05-01.md`,
`RDS-ELASTICACHE-CUTOVER-RUNBOOK.md`, `SDK-DOWNLOAD-ENDPOINT.md`,
`SDK-PLATFORM-*.md`) stay live as **input sources** until they are
folded into doc 5 (Deployment) in the next session, at which point they
also move to archive.

`v3.1.2/pending_implementation_docs/` and `v3.1.2/superseded/` remain
as historical snapshots; do not edit them. New planning content goes
into doc 4 (Project-Tracker §2 "PENDING") and doc 8 (for data plans).

---

## Where to start, by role

| Role | Read first | Then |
|---|---|---|
| **CXO / business owner** | doc 1 (Business Product Note) §1, §3, §9 | doc 4 §1 (pinned facts) |
| **Product manager** | doc 1 §4 (capabilities), §7 (user journeys) | doc 4 §2 (built vs pending) |
| **Solution architect** | doc 2 (Technical Product Note) §3 (ecosystem wiring), §21 (deployment topology) | doc 8 (data + RAG + memory) |
| **Integrator (NYM/NSP/NSI/NSA/NSM)** | doc 2 §22 (SDK suite) | `v3.1.2/SDK-RELEASE-2026-05-03.md` (until folded into doc 5) |
| **SRE / release engineer** | doc 4 §1 (deploy facts), §5 (changelog) | doc 5 (Deployment) once consolidated; `v3.1.2/PRE-GA-STATUS-2026-05-03.md` until then |
| **Security / compliance** | doc 6 once consolidated; threat model output until then | doc 7 (audit) |
| **RAG / data engineer** | doc 8 (RAG action plan + DB architecture) | doc 4 §1 statute counts |

---

## How to add new content

1. Find which of the eight docs it belongs in (use the table above).
2. Edit that doc in place. Add a dated subsection if the change is large.
3. Append a `Project-Tracker.md §5` entry with ISO timestamp + a one-line
   pointer at the doc + section you updated.
4. **Do not** create a new top-level doc, even for a "small" plan.
