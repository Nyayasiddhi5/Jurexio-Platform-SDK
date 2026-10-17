# AGENTS.md — Nyayavigya Platform Guardrails

> Audience: every Replit Agent (main / task / design subagent), every
> human collaborator, every CI job that runs against this repository.

This file is a **guardrail contract**, not advice. Failure to follow it
breaks our audit trail and our deployment safety story.

---

## 0. Dual-project ops (Nyayavigya + NYS-Agentic-AI)

This workspace contains **two products** deployed to **two EC2 instances**:

| Tag | Tree | EC2 | URL |
|---|---|---|---|
| **NYV** | `nyayavigya-platform-312/` | nysdev `i-0df71e5ea1df8f588` | api / console |
| **NYS** | `NYS-Agentic-AI/` | nyv-caselaw-worker `i-000115b19219bb766` | `nyayasearch.nyayasiddhi.online` |

Before any edit: classify **NYV / NYS / BOTH**. Full operating contract:
`documents/working/DUAL-PROJECT-OPS-NYV-NYS-2026-07.md`. Production deploy needs explicit **GO**.

---

## 1. Mandatory tracking on every change

For **any** change — code, schema, infra, secrets, SDK surface,
documentation, dependencies, or workflow config — you MUST, before
declaring the change complete:

1. **Append a row to `Project-Tracker.md`** under "Change log (newest first)".
   Required columns: ISO-8601 UTC timestamp, status (`PLANNED` /
   `IN-PROGRESS` / `DONE` / `BLOCKED` / `ROLLED-BACK`), owner, area,
   one-line summary, evidence pointer (commit SHA, log path, test ID, or
   live URL response code).
2. **Add an entry to `CHANGELOG.md`** under the right release section
   (`Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security`).
   Skip only for truly trivial changes (typo fixes, comment edits).
3. If the change touches the **SDK surface**, also update the
   per-package CHANGELOG (`packages/<sdk>/CHANGELOG.md`).
4. If the change adds, removes, or re-prioritises a roadmap item, update
   **`documents/roadmap-pending/PLATFORM-ROADMAP-v3.1.2.md`**.

The commit message MUST cite the Project-Tracker entry timestamp, e.g.:

```
feat(legal-chat): add SME rubric → GRPO write-back

Tracker: 2026-04-26T22:14:00Z
Changelog: [3.1.2-managed-services] Added — Legal Chat dashboard
```

## 2. Documentation layout (do not break)

```
/                                  ← root
├─ Project-Tracker.md              ← audit ledger (this is the source of truth)
├─ CHANGELOG.md                    ← detailed narrative changelog
├─ AGENTS.md                       ← this file (guardrails)
├─ README.md                       ← repo entry point
├─ replit.md                       ← Replit-Agent operating notes
├─ deployment-status.md            ← live infra snapshot
└─ documents/
   ├─ completed/                   ← legacy + done docs (read-only history)
   ├─ working/                     ← active product / technical / UAT / status
   └─ roadmap-pending/             ← anything not yet shipped
```

Rules:

- **Never** add new top-level `.md` files at the repository root other than
  the six listed above.
- **Never** edit files under `documents/completed/` — they are immutable
  history. If a completed doc needs revision, copy it to
  `documents/working/`, edit there, and supersede.
- **Always** keep `documents/working/PLATFORM-STATUS.md` current; this is
  the single page anyone (PM, sales, SME, ops) should be able to open to
  know what is live, what is in flight, and what is pending.

## 3. Secrets handling

- **Never** echo a secret value into any agent message, log, file under
  version control, or user-visible chat output. The same rule applies to
  passwords, API keys, JWT secrets, AWS access keys, and DB URIs that
  contain credentials.
- The only place secret **values** may live is `.local/secrets/`
  (chmod 600, in `.gitignore`). Hand them off to humans via secure
  side-channel (Bitwarden / 1Password share, encrypted message).
- Every key rotation MUST also: (a) update `Project-Tracker.md` with the
  new generation timestamp; (b) update `documents/working/NSP-API-KEYS-HANDOVER.md`
  with the new "generated at" stamp (no values).

## 4. Database changes

- Use `npm run db:push --force` only after eyeballing the diff. Never
  hand-write `ALTER TABLE` migrations.
- Preserve existing primary-key column types — never `serial ↔ varchar`.
- After any schema change, log the migration in `Project-Tracker.md` and
  capture row counts of affected tables in `CHANGELOG.md`.

## 5. Deployment safety

- Production deployment target: AWS EC2 (`13.232.165.242`) running
  `docker-compose.aws-dev.yml`.
- Before declaring a deployment complete, run the smoke set at the bottom
  of `documents/working/UAT-TEST-PLAN.md` and capture the response codes
  in the Tracker entry.
- Roll forward, not back, unless the rollback is explicitly approved by
  the user. The previous gateway/console images are kept tagged
  `:rollback-YYYYMMDD` for 7 days.

## 6. SDK changes

- Every change to a `packages/<sdk>/src/**` file requires a SemVer bump
  in that package's `package.json` AND a new entry in that package's
  `CHANGELOG.md`. Cross-link from root `CHANGELOG.md`.

## 7. Workflow / tooling changes

- Adding, renaming, or removing a Replit workflow → log in
  `Project-Tracker.md` AND update the relevant section of `replit.md`.
- Bumping a major dependency (Node, Next, Drizzle, Vite, etc.) → log
  under `### Tooling` in `CHANGELOG.md`.

---

If you are reading this and about to make a change, the next thing you
should do is open `Project-Tracker.md` and stage the new row. Do that
first. Make the change second.
