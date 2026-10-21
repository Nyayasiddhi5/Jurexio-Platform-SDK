# JRX SOC 2 Type II & ISO/IEC 42001 — auditor engagement pack

**Compliance GO:** 2026-10-21  
**System:** Jurexio Enterprise Platform — `https://jurexio.nyayasiddhi.online`  
**Infrastructure (existing — no new infra):** EC2 `i-0fb470b236c14405b`, RDS `jrx-enterprise-pg`, SSM `/jurexio/prod/*`, ALB TLS  
**Parent evidence map:** [JRX-SOC2-ISO42001-EVIDENCE-PROGRAM.md](./JRX-SOC2-ISO42001-EVIDENCE-PROGRAM.md)

---

## 1. Engagement scope (suggested)

| Audit | Scope boundary |
|-------|----------------|
| **SOC 2 Type II** | Jurexio gateway + console + SDK auth, change management, audit logging, availability of production EC2/ALB |
| **ISO 42001** | AI governance: agent registry, protocol registry, HITL/e-filing review, GRPO feedback, jurisdiction binding |

**Out of scope unless added:** Customer tenant data processing agreements, third-party LLM subprocessors (Bedrock/OpenAI/etc.) — list separately in ROPA.

---

## 2. Exhibit index (prepare for auditor)

| Exhibit | Description | Location |
|---------|-------------|----------|
| A | Change log + deploy evidence | `Project-Tracker.md`, `CHANGELOG.md`, `/cursor/stores/self/docs/jrx-deploy-result.md` |
| B | Access control | RBAC matrix `rbac-service.ts`; SDK key hashing `sdk_applications` |
| C | Audit trail | Hash-chain routes `/api/jrx/audit/*`; seed runbook PR #8 |
| D | CI / SDLC | `.github/workflows/jrx-ci.yml`, `guardrail:jrx-brands` |
| E | AI system inventory | `src/data/jrx-agents-registry.json`, protocol_registry |
| F | Risk & jurisdiction controls | `jrx-jurisdiction-binding-middleware.ts`, outcome sanitize |
| G | Incident / ops | SSM command IDs, health monitors, `jrx-smoke-ec2.sh` |
| H | Data residency | Jurisdiction routes, `JRX-DATA-RESIDENCY` docs (working/) |

---

## 3. Control testing — sample procedures

1. **CC6.1:** Request SDK key auth denial (401) and console JWT 403 on admin route — HTTP codes only in workpapers.  
2. **CC8.1:** Export audit chain head + verify genesis after greenfield seed (no secret values).  
3. **CC7.2:** Trace one production deploy to Tracker row + git SHA.  
4. **ISO 42001 §8:** Sample agent prompt resolver load for US vs IN — verify different jurisdiction injection.  
5. **ISO 42001 §9:** GRPO preference POST with test key — confirm queue accept/reject logging.

---

## 4. Customer / operator actions before fieldwork

- [ ] Name **system owner** and **security contact** for Jurexio tenant.  
- [ ] Complete **super_admin access review** (quarterly).  
- [ ] Set **`A2A_HMAC_SECRET`** in production if multi-agent A2A is enabled.  
- [ ] Provide **subprocessor list** (AWS, Bedrock, email, etc.).  
- [ ] Sign **MSA + DPA** template (legal — not in repo).

---

## 5. Certification disclaimer

This pack supports **readiness** and **auditor fieldwork**. It does **not** constitute SOC 2 Type II or ISO 42001 certification until an accredited body issues a report.
