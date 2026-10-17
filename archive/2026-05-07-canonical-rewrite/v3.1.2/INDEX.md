---
status: living
version: 3.1.2
last_verified: 2026-05-05
---

# `docs/v3.1.2/` — Index

This index lists every living document in `docs/v3.1.2/`. Anything not
listed here that is not in `superseded/` or `completed_docs/` is either
a stale candidate or new and not-yet-indexed — file an issue or update
this file.

> Last reconciled: **2026-05-05** (post-NYV-AUDIT-F6..F13 doc pass).

## 1. Canonical reference (read this first)

| File | Purpose |
|---|---|
| [`SDK-ENDPOINTS-CANONICAL-2026-05-05.md`](./SDK-ENDPOINTS-CANONICAL-2026-05-05.md) | **Authoritative** endpoint truth-table, live-probed against all 7 SDK keys on 2026-05-05. Supersedes the 2026-05-02 version (now in `superseded/`). |
| [`NYV-SDK-API-INTEGRATION-GUIDE-2026-05-04.md`](./NYV-SDK-API-INTEGRATION-GUIDE-2026-05-04.md) | Full integration guide for all **7 platforms** (NSP, NSPM, NYM, NSI, NSA, NSM, JRX). §0.2 quick-table, §6 access matrix, Appendix B env-vars. |
| [`NYV-MASTER-INTEGRATION-GUIDE-2026-05-04.md`](./NYV-MASTER-INTEGRATION-GUIDE-2026-05-04.md) | Operator-facing master guide (deploy, S3, code structure). |

## 2. Per-platform SDK guides

| File | Platform |
|---|---|
| [`SDK-PLATFORM-NSP-WEB.md`](./SDK-PLATFORM-NSP-WEB.md) | Nyayasiddhi Professional™ (Web) |
| [`SDK-PLATFORM-NSP-MOBILE.md`](./SDK-PLATFORM-NSP-MOBILE.md) | Nyayasiddhi Professional Mobile™ |
| [`SDK-PLATFORM-NYAYAMITRA.md`](./SDK-PLATFORM-NYAYAMITRA.md) | Nyayamitra™ Citizen App |
| [`SDK-PLATFORM-NSI.md`](./SDK-PLATFORM-NSI.md) | Nyayasiddhi Institutional™ |
| [`SDK-PLATFORM-JRX.md`](./SDK-PLATFORM-JRX.md) | JurisX™ |

> NSA (Academy) and NSM (Ministry) are covered in the integration guide §0.2 + §6
> matrix. Per-platform guides for those two are pending — see the follow-ups doc.

## 3. Operations + audit reports

| File | Purpose |
|---|---|
| [`NYV-OPS-RUNBOOK.md`](./NYV-OPS-RUNBOOK.md) | Ops SOP — deploy, rollback, key mint. |
| [`RDS-ELASTICACHE-CUTOVER-RUNBOOK.md`](./RDS-ELASTICACHE-CUTOVER-RUNBOOK.md) | DB / cache cutover procedure. |
| [`SDK-DEV-EC2-ACCESS-2026-05-01.md`](./SDK-DEV-EC2-ACCESS-2026-05-01.md) | EC2 SSM access procedure for the dev gateway. |
| [`SDK-DOWNLOAD-ENDPOINT.md`](./SDK-DOWNLOAD-ENDPOINT.md) | SDK tarball download endpoint contract. |
| [`SDK-RELEASE-2026-05-03.md`](./SDK-RELEASE-2026-05-03.md) | v5.0.0 release notes. |
| [`PRE-GA-STATUS-2026-05-03.md`](./PRE-GA-STATUS-2026-05-03.md) | Pre-GA readiness snapshot. |
| [`NYV-DEVELOPER-AUDIT-REPORT-2026-05-04.md`](./NYV-DEVELOPER-AUDIT-REPORT-2026-05-04.md) | Developer audit report (corrected 2026-05-05 to reflect 7 platforms). |
| [`NYV-LIVE-AUDIT-GAP-REPORT-2026-04-27.md`](./NYV-LIVE-AUDIT-GAP-REPORT-2026-04-27.md) | Audit gap report (April baseline). |
| [`NYV-SCHEMA-MIGRATION-CONFIRMATION-2026-04-27.md`](./NYV-SCHEMA-MIGRATION-CONFIRMATION-2026-04-27.md) | Schema migration confirmation (April baseline). |
| [`NYV-DATABASE-CANONICAL-2026-05-05.md`](./NYV-DATABASE-CANONICAL-2026-05-05.md) | **Canonical DB reference** — every live table by domain, schema-of-truth (public vs nv_schema), Drizzle export, primary writer/reader, B1+B2 consolidation record, RDS migration quirks, parity guardrail usage. |

## 4. Pending / planning

| File | Purpose |
|---|---|
| [`pending_implementation_docs/NYV-AGENT-SUGGESTED-FOLLOWUPS.md`](./pending_implementation_docs/NYV-AGENT-SUGGESTED-FOLLOWUPS.md) | Consolidated list of every agent-proposed follow-up with provenance back to merged task IDs. Re-verified 2026-05-07 (provenance expanded to all 28 distinct merged Task IDs). |

## 5. Archives

- [`completed_docs/`](./completed_docs/) — historical docs that completed their lifecycle (kept for traceability; do not edit).
- [`superseded/`](./superseded/) — explicitly replaced docs (e.g. `SDK-ENDPOINTS-CANONICAL-2026-05-02.md` → see `SDK-ENDPOINTS-CANONICAL-2026-05-05.md`).

## Maintenance

When adding a new doc to `docs/v3.1.2/`, append it to the appropriate
section above and bump `last_verified`. When superseding a doc, move
the old file to `superseded/` and add a stub `*.NOTE` pointing to the
replacement.
