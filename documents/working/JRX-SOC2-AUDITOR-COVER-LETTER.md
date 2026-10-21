# Jurexio Enterprise — SOC 2 Type II & ISO/IEC 42001 readiness (cover letter)

**Date:** 21 October 2026  
**To:** [Auditor firm name]  
**From:** [System owner name], [Title], NYAYASIDDHI LEGALTECH PVT LTD  
**Re:** Readiness materials for SOC 2 Type II and ISO/IEC 42001 fieldwork — Jurexio Enterprise Platform

---

Dear [Auditor contact],

We are engaging your firm to perform readiness review and fieldwork for **SOC 2 Type II** (security, availability, and change management over the Jurexio production boundary) and **ISO/IEC 42001** (AI management system controls) for the **Jurexio Enterprise Platform**.

**In-scope system**

- Production URL: `https://jurexio.nyayasiddhi.online`
- Components: API gateway, operator console, SDK authentication (`X-API-Key` / JWT), agent orchestration, audit logging, and jurisdiction-aware legal AI services
- Infrastructure (existing, dedicated tenant): AWS EC2 `i-0fb470b236c14405b`, RDS PostgreSQL `jrx-enterprise-pg`, Application Load Balancer with TLS, secrets in SSM prefix `/jurexio/prod/*`, region `ap-south-1`

**Out of scope unless separately contracted**

- Customer tenant data processing agreements and records of processing (ROPA)
- Subprocessor attestations (AWS, model providers, email) — we will provide a subprocessor list under NDA
- Certification itself — this package supports **readiness and evidence collection**, not an assertion of compliance until your report is issued

**Enclosed materials**

1. **Auditor engagement pack** — `documents/working/JRX-SOC2-ISO42001-AUDITOR-PACK.md` (exhibits A–H, sample test procedures, pre-fieldwork checklist)
2. **Control mapping** — `documents/working/JRX-SOC2-ISO42001-EVIDENCE-PROGRAM.md`
3. **Change and deploy evidence** — `Project-Tracker.md`, `CHANGELOG.md`, and recent SSM deploy command IDs (provided separately; no secret values)

**Our commitments before fieldwork**

- Designated **system owner** and **security contact** (names below)
- Quarterly **super_admin** access review
- Production **`A2A_HMAC_SECRET`** configured if multi-agent A2A is enabled
- Signed **MSA/DPA** and subprocessor disclosure (legal team)

| Role | Name | Email |
|------|------|-------|
| System owner | [Name] | [email] |
| Security contact | [Name] | [email] |

We request a scoping call to confirm trust services criteria, ISO 42001 clause boundaries, and sampling periods for Type II. Test accounts and read-only operational access can be provisioned under NDA.

This letter and the attached documents **do not constitute SOC 2 Type II or ISO 42001 certification**.

Sincerely,

[Signature]  
[System owner name]  
NYAYASIDDHI LEGALTECH PVT LTD, Hyderabad, India
