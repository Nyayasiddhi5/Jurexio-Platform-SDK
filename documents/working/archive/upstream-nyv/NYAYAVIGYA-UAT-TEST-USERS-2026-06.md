# Nyayavigya UAT Test Users & Login URLs (2026-06)

> **Environment:** EC2 dev-edge · `https://console.nyayasiddhi.online`
> **Deploy verified:** `2026-06-16T0620Z-replit-ssm` — separate Console vs LegalChat login routing live.

> ### GAP-009 — Legal Chat UAT credentials (2026-09-07)
>
> **The §2 LegalChat UAT trio passwords may be stale** on nysdev: live EC2 hashes follow **`NV_DEMO_PASSWORD`** (and `scripts/_ec2-seed-uat-users.sh` / `nv-seed-uat-platform-users.ts`), not necessarily the literals in the table below. Copy-paste from §2 often returns **401 Unauthorized**.
>
> **For LC5–LC7 Console Legal Chat UAT:** sign in at [Console login](https://console.nyayasiddhi.online/console/login) with seeded **`admin@nyayavigya.in`** — password is **`NV_DEMO_PASSWORD`** on the host (seeded platform demo user — **§3** below; LC5–LC8 auth also in **`UAT-TEST-PLAN-v2-2026-09.md` §4**; ask ops — **never** paste or commit it). Do **not** rotate passwords or keys from UAT docs alone.
>
> **Repeatable browser run:** from `nyayavigya-platform-312`, `node scripts/nv-uat-lc5-lc8-browser.mjs` (uses env / operator creds — not §2 literals).



---

## 1. Two login surfaces (do not mix them)

| Surface | Who | Login URL | Lands on |
|---|---|---|---|
| **Platform Console** | Super-admin, org admins, developers, analysts | [https://console.nyayasiddhi.online/console/login](https://console.nyayasiddhi.online/console/login) | Role-based (see §2) |
| **LegalChat SME shell** | Subject Matter Experts (`sme` role only at login) | [https://console.nyayasiddhi.online/legalchat/login](https://console.nyayasiddhi.online/legalchat/login) | `/legalchat/chat` |

**Routing rules (live after 2026-06-16 deploy):**

- Signing in at **LegalChat login** with a **non-SME** role (e.g. `super_admin`) → auto-redirect to **Console** home.
- Signing in at **Console login** as **super_admin** → `/console/superadmin/overview`.
- **Super-admin** can still open LegalChat UAT from Console sidebar → **LegalChat UAT** (intentional for testing).

---

## 2. Provisioned LegalChat & platform UAT users (recommended)

> **Stale-password warning (GAP-009):** Treat the **Password** column as historical unless ops confirms a recent `_ec2-seed-uat-users.sh` run. Prefer **`admin@nyayavigya.in`** + **§3** / `NV_DEMO_PASSWORD` for Legal Chat browser UAT.

| Handle | Email | Password | Role | Login at | Primary use |
|---|---|---|---|---|---|
| **UAT-PLATFORM-ADMIN** | `legalchat-admin-uat@nyayavigya.in` | `Nyv!UAT#Admin@2026#A1` | `super_admin` | **Console login** | Full platform: all orgs, SDK keys, platform registry, RBAC, LegalChat SME allocation |
| **UAT-SME-A** | `legalchat-sme-a-uat@nyayavigya.in` | `Nyv!UAT#SmeA@2026#B2` | `sme` | **LegalChat login** | LegalChat workspace, GRPO rubric, chat UAT |
| **UAT-SME-B** | `legalchat-sme-b-uat@nyayavigya.in` | `Nyv!UAT#SmeB@2026#C3` | `sme` | **LegalChat login** | Second SME (session isolation / allocation tests) |

### LegalChat admin workflows (UAT-PLATFORM-ADMIN)

Use **Console login** → then LegalChat admin APIs or in-shell super-admin panel:

| Task | Where |
|---|---|
| Issue SME credentials / setup link | `POST /api/nv/legal-chat/sme-allocations/issue` (super_admin) |
| Manage SME allocations | LegalChat shell → Allocations panel (super_admin in `/legalchat/chat`) |
| Assign jurisdictions / models to SMEs | SME allocation APIs + Console RBAC |

---

## 3. Platform demo users (Console — shared demo password)

Seeded by `scripts/nv-seed-users.ts` on EC2. Password = **`NV_DEMO_PASSWORD`** in `/opt/Nyayavigya/secrets/.env.production` (operator-managed — ask ops; not stored in git).

| Email | Role | Console landing | Typical use |
|---|---|---|---|
| `admin@nyayavigya.in` | `super_admin` | `/console/superadmin/overview` | Legacy SDK administrator demo |
| `manager@demo.nyayavigya.in` | `manager` | `/console/dashboard` | Team lead console features |
| `analyst@demo.nyayavigya.in` | `analyst` | `/console/dashboard` | Intelligence / HITL analyst |
| `operator@demo.nyayavigya.in` | `operator` | `/console/dashboard` | Orchestration operator |
| `dev@demo.nyayavigya.in` | `developer` | `/console/dashboard` | SDK playground / API tester |
| `user@demo.nyayavigya.in` | `user` | `/console/dashboard` | Read-mostly console user |

---

## 4. Multi-tenant org demo users (org-scoped)

Seeded by `scripts/nv-seed-demo-tenants.ts`. **Password for all:** `Demo@2026!`

| Email | Org | Role in seed | Console path |
|---|---|---|---|
| `admin@demo-law-firm-in.demo.nyayavigya.test` | Demo Law Firm (IN) | `admin` | Org-scoped admin (map to org console) |
| `lawyer@demo-law-firm-in.demo.nyayavigya.test` | Demo Law Firm (IN) | `lawyer` | Matter user |
| `viewer@demo-law-firm-in.demo.nyayavigya.test` | Demo Law Firm (IN) | `viewer` | Read-only |
| `admin@demo-corporate-us.demo.nyayavigya.test` | Demo Corporate (US) | `admin` | NSI-style enterprise org |
| `admin@demo-citizen-in.demo.nyayavigya.test` | Demo Citizen (IN) | `admin` | NYM-style citizen org |

> **Note:** Seed uses role `admin` / `lawyer` / `viewer` — map to **`org_admin`** in RBAC console if you need canonical org-admin tier for a tenant.

---

## 5. Role → capability matrix

| Role | Scope | Console | LegalChat login | LegalChat UAT (via sidebar) | SDK keys | All orgs |
|---|---|:---:|:---:|:---:|:---:|:---:|
| `super_admin` | Global platform | ✅ | ❌ (redirects to Console) | ✅ | ✅ | ✅ |
| `platform_admin` | One ecosystem platform | ✅ | ❌ | — | ✅ (scoped) | Platform-scoped |
| `enterprise_admin` | Enterprise super-org | ✅ | ❌ | — | ✅ | Super-org |
| `org_admin` | Single customer org | ✅ `/org-admin` | ❌ | — | Org-scoped | Own org |
| `manager` / `analyst` / `operator` / `developer` | Feature-tier | ✅ | ❌ | — | Read/use | Own org |
| `sme` | LegalChat expert | ❌ | ✅ | ✅ | — | Own sessions |

---

## 6. Quick verification commands

```bash
# API login (returns JWT + role) — use admin@nyayavigya.in + NV_DEMO_PASSWORD from ops (§3); do not use §2 literals if login returns 401
curl -sS -X POST https://api.nyayasiddhi.online/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@nyayavigya.in","password":"$NV_DEMO_PASSWORD"}' \
  | jq '{role: .user.role, email: .user.email}'

# Repeatable LC5–LC7 browser UAT (nyayavigya-platform-312)
# node scripts/nv-uat-lc5-lc8-browser.mjs

# Health
curl -sS https://api.nyayasiddhi.online/api/nv/health | jq '{status, agents: .agents.totalAgents}'
```

---

## 7. Password reset (EC2 ops only)

LegalChat UAT trio: `nyayavigya-platform-312/.local/secrets/ec2-reset-legalchat-uat-passwords.sh` (run on EC2 gateway container — ops access required).

Demo users: re-run `npx tsx scripts/nv-seed-users.ts` with `NV_DEMO_PASSWORD` set on EC2.

---

## 8. Related docs

| Doc | Path |
|---|---|
| LegalChat UAT cases | `documents/working/LEGALCHAT-UAT-TESTCASES-2026-06.md` |
| Platform UAT cases | `documents/working/NYAYAVIGYA-UAT-TESTCASES-2026-06.md` |
| NSP SDK integration | `documents/working/NSP-PARTNER-SDK-INTEGRATION-GUIDE-2026-06.md` |

---

*UAT passwords in this doc are dev-sandbox only — rotate before external auditor access.*
