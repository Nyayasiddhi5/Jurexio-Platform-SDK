# US Compliance Gap Analysis — 2026-05-14

> **Audience.** Engineering leadership, product, and compliance. This is the engineering-internal companion to canonical doc `15-us-compliance-matrix-2026-05-14.md` (the customer-facing "what we cover today" matrix). Where the matrix lists frameworks Nyayavigya enforces, this document lists the frameworks it **does not** — with a verdict on which gaps are real, which are intentionally out-of-scope, and a sized engineering shortlist for closing the real ones.
>
> **Method.** For each candidate framework I (a) read the candidate against the canonical baseline (`15-us-compliance-matrix-2026-05-14.md` + `13-us-compliance-status-2026-05-13.md`), (b) grepped the implementation surfaces — `src/services/compliance/nv-policy-engine.ts`, `src/middleware/nv-jurisdiction-binding-middleware.ts`, `src/middleware/nv-bipa-consent-gate.ts`, `src/services/compliance/nv-breach-notice-service.ts`, `src/services/regulatory-monitor/regulatory-monitor-service.ts`, `config/agent-registries/Nyayavigya-Legal-registry-US.json`, `src/services/jurisdiction-agents/usa-agents-generator.ts`, `src/config/{nyv-sdk-production-config,platform-config}.ts`, `src/services/nv-system-prompt-engine.ts`, `scripts/nv-seed-{policies,internal-security,compliance-catalog}.ts` — and (c) classified each as `covered` / `partial` / `gap` / `out-of-scope` with a one-line justification, an evidence path where applicable, the SKU(s) that would drive the requirement, and a coarse S/M/L/XL effort tier for closing it. **No code, no policy seeds, no migrations were written for this analysis.**
>
> **Scope.** US frameworks only. Non-US regimes (DPDPA, GDPR, UK-GDPR, MAS, PDPA-SG, etc.) are tracked separately and out of scope here.

---

## Effort tier legend

| Tier | What it means in our codebase |
|---|---|
| **S** | Documentation + ≤2 policy seeds in `nv-policy-engine.ts` + 1 regulator probe row in `regulatory-monitor-service.ts`; no new middleware, no new tables, no third-party attestation. |
| **M** | New policy seeds + at least one new pre-flight middleware (mounted on a specific route family) + a few new audit-record event types; no new tables; no third-party attestation. |
| **L** | New policy seeds + new middleware + new DB tables (additive, NV-API-CONTRACT-001 safe) + a new Console drilldown OR new breach-notice recipient set; possibly a new background worker; **no third-party attestation** required. |
| **XL** | All of the above PLUS an external attestation / audit cycle (3PAO, QSA, HITRUST AB) PLUS multi-quarter ConMon discipline OR boundary controls (US-person staffing, US data residency, FIPS modules, etc.). |

---

## SKU demand legend

| SKU | Audience | Frameworks they care about most |
|---|---|---|
| **NSP** | Law firms | ABA ethics + state bar privacy notices; HIPAA when representing healthcare clients |
| **NSPM** | Law-firm matter mgmt (paralegal/admin) | Same as NSP, with billing-data PCI / GLBA exposure if firms accept card payment |
| **NSI** | Enterprise legal | GLBA + Safeguards (financial enterprises), HIPAA / HITRUST (healthcare), SOX, PCI-DSS, NYDFS-500 |
| **NSM** | Government | FedRAMP Moderate (today) → **High**, StateRAMP, FISMA, NIST 800-53 Rev 5, IRS Pub 1075, CJIS, NIST CSF 2.0, NIST AI RMF |
| **NSA** | Legal education | **FERPA** (the only ed-tech-relevant US framework), COPPA-adjacent for K-12 / minors |
| **NYM** | Citizens | COPPA (if any user < 13), state privacy acts in their state of residence |
| **JRX** | US judicial / corporate-counsel | Same enterprise stack as NSI; FCRA when ingesting consumer reports |

---

## 1. Federal privacy & sectoral

| # | Framework | Citation | Status | Justification (with evidence) | SKU demand | Effort to close |
|---|---|---|---|---|---|---|
| 1 | **GLBA Safeguards Rule** | 16 C.F.R. Part 314 (FTC) | **partial** | Surfaced indirectly via the FTC + CFPB regulator probes (`src/services/regulatory-monitor/regulatory-monitor-service.ts:149-170`) and listed declaratively in `src/config/nyv-sdk-production-config.ts:401,407` and `src/config/platform-config.js:191`, and tagged on a single internal-security row (`scripts/nv-seed-internal-security.ts` framework refs). **No dedicated `POL-US-GLBA-*` row in `nv-policy-engine.ts`**, no §314.4(c)-style pre-flight gate, no §314.5 incident-notification recipient set in `nv-breach-notice-service.ts`. The `13-us-compliance-status-2026-05-13.md` row already concedes "PARTIAL — policy + 2 probes live; no dedicated page". | NSI (FinServ enterprises), NSPM (firms holding cardholder data) | **M** — add `POL-US-GLBA-314.4` policy seed, FTC §314.5 incident-notice recipient set in `nv-breach-notice-service.ts`, and a designated-coordinator + risk-assessment audit event-type. No new tables. |
| 2 | **COPPA** | 15 U.S.C. §6501–6506 + 16 C.F.R. Part 312 | **gap** | Listed declaratively in `src/services/nv-system-prompt-engine.ts:121` and `src/config/nyv-sdk-production-config.ts:401` only. **No `POL-US-COPPA-*` seed**, no age-gate middleware, no parental-consent capture surface, no FTC COPPA-safe-harbor data-retention worker. NYM is the only SKU realistically exposed (citizens may be under 13). | NYM (consumer surface), NSA (K-12 ed-tech adjacencies) | **M** — age-self-attestation + verifiable-parental-consent gate on NYM signup; `POL-US-COPPA-312.5` seed; data-retention worker honouring §312.10. Out-of-scope unless NYM opens to under-13 users (today's ToS say 13+). |
| 3 | **FERPA** | 20 U.S.C. §1232g + 34 C.F.R. Part 99 | **gap** | Listed declaratively in `src/services/nv-system-prompt-engine.ts:121` and `src/config/nyv-sdk-production-config.ts:407` only. **No FERPA policy, no education-record classifier, no §99.31 directory-information opt-out flow.** Material only for NSA when used by a US "educational agency or institution" receiving Department of Education funds. | NSA (only) | **M** — `POL-US-FERPA-99.31` seed, education-record classifier in the PII-redaction ring, directory-information opt-out field on NSA learner profiles. Confined to NSA codepath. |
| 4 | **HITECH Breach Notification (HIPAA Subtitle D)** | 42 U.S.C. §17932 + 45 C.F.R. Part 164 Subpart D | **partial** | HIPAA Privacy Rule covered (`POL-US-HIPAA-164.502` in `nv-policy-engine.ts:58-70`) and `usa-agents-generator.ts:51,108` tags HIPAA + HITECH on agent rows, but **no breach-notification pipeline lights up the §164.408 HHS-Secretary recipient or the §164.406 media-notice path** in `src/services/compliance/nv-breach-notice-service.ts` (the file already implements NY + MA recipient sets). | NSI (healthcare), JRX | **S** — add HHS-Secretary + §164.406 media recipients to `RECIPIENTS` in `nv-breach-notice-service.ts`; add `POL-US-HIPAA-164.408` seed. No new tables. |
| 5 | **FCRA** (Fair Credit Reporting Act) | 15 U.S.C. §1681 et seq. | **gap** | No mention anywhere in `src/`, `config/`, or canonical docs. Triggered only if a customer ingests "consumer reports" through a Nyayavigya workflow (e.g. JRX background-check matter) — narrow but real for NSI/JRX. | NSI, JRX | **M** — `POL-US-FCRA-1681b` seed, permissible-purpose pre-flight on any document classified as "consumer report", §1681m adverse-action-notice template surfaced in the document-pipeline. |
| 6 | **FTC Act §5 — UDAP** | 15 U.S.C. §45 | **partial** | Already documented as `partial` in `15-us-compliance-matrix-2026-05-14.md` row 1. Covered indirectly by the FTC regulator probe (`regulatory-monitor-service.ts:152`) and the mandatory AI-output disclosure clause in `nv-jurisdiction-binding-middleware.ts:124`. **No dedicated `POL-US-FTC-5` seed.** | All US SKUs | **S** — add `POL-US-FTC-5` seed referencing §5 UDAP and the existing disclosure clause. |

## 2. State privacy acts (post-CCPA wave)

CCPA/CPRA, VCDPA, CPA are **covered**; the rest are missing. The agent-registry generator (`src/services/jurisdiction-agents/usa-agents-generator.ts:73,495`) already names CTDPA + UCPA in agent `complianceFrameworks`, but no policy seeds, no `nv_policies` rows, no Console drilldowns exist for them.

| # | Framework | Citation | Status | Justification | SKU demand | Effort |
|---|---|---|---|---|---|---|
| 7 | **CTDPA** (Connecticut) | C.G.S. §42-515 et seq. | **gap** | Named in agent-generator only (`usa-agents-generator.ts:73,495`); no `POL-US-CTDPA-*` seed, no DSAR routing, no CT-OAG regulator probe. | NSI, JRX | **S** — policy seed mirroring the VCDPA/CPA shape (`nv-policy-engine.ts:100-128`), CT-OAG probe row in `regulatory-monitor-service.ts`. |
| 8 | **UCPA** (Utah) | Utah Code §13-61-101 et seq. | **gap** | Same as CTDPA. | NSI, JRX | **S** — same shape as CTDPA. Note: UCPA has no opt-out-of-profiling and a longer cure period — wording in the seed differs from VCDPA/CPA. |
| 9 | **TDPSA** (Texas) | Tex. Bus. & Com. Code §541.001 et seq. | **gap** | Texas listed in `usa-agents-generator.ts:28` jurisdictions only — no statute reference, no policy seed. TDPSA is in force (eff. 2024-07-01) and has no SMB carve-out, so it materially affects any NSI/NSP customer doing business in TX. | NSP, NSI | **S** — policy seed + TX-OAG probe row. |
| 10 | **OCPA** (Oregon) | Or. Rev. Stat. §646A.570 et seq. | **gap** | No mention anywhere. In force 2024-07-01 (commercial entities) / 2025-07-01 (non-profits). | NSI, NSP, JRX | **S** — policy seed + OR-DOJ probe row. |
| 11 | **MTCDPA** (Montana) | Mont. Code Ann. §30-14-2801 et seq. | **gap** | No mention anywhere. In force 2024-10-01. | NSI | **S** — policy seed + MT-OCP probe row. |
| 12 | **ICDPA** (Iowa) | Iowa Code §715D | **gap** | No mention anywhere. In force 2025-01-01; weaker than VCDPA (no profiling opt-out, no DPA), shortest seed. | NSI | **S** — policy seed + IA-OAG probe row. |
| 13 | **DPDPA** (Delaware) | 6 Del. C. Ch. 12D | **gap** | No mention anywhere; **easy to confuse with India's DPDPA which is unrelated**. In force 2025-01-01. | NSI, NSP | **S** — policy seed + DE-DOJ probe row, with a code-comment disambiguating from `POL-IN-DPDPA-*`. |
| 14 | **NJDPA** (New Jersey) | P.L. 2024, c.16 | **gap** | No mention anywhere. In force 2025-01-15; covers sensitive-data opt-in. | NSI, NSP, JRX | **S** — policy seed + NJ-OAG probe row. |
| 15 | **NHCPDA** (New Hampshire) | RSA 507-H | **gap** | No mention anywhere. In force 2025-01-01. | NSI, NSP | **S** — policy seed + NH-DOJ probe row. |
| 16 | **NJ Daniel's Law** (judges' addresses) | N.J.S.A. 47:1B | **out-of-scope** | We do not maintain residential-address fields on judges or law-enforcement subjects in any first-party data model; counsel can ingest such data into matter-bound documents but we do not publish it. Reconsider only if the agent registry adds a "judge profile" surface. | NSP, JRX | n/a |

## 3. Federal-government & defense

| # | Framework | Citation | Status | Justification | SKU demand | Effort |
|---|---|---|---|---|---|---|
| 17 | **FedRAMP High** | FedRAMP PMO + NIST SP 800-53 Rev 5 High baseline | **gap** | FedRAMP **Moderate** is the current target (`POL-US-FEDRAMP-MOD` in `nv-policy-engine.ts:178-192`). High requires a different control selection (~421 controls vs ~325), additional cryptographic boundary controls, and a separate ATO package. No High control mapping exists today. | NSM (only — and only if the agency requires Hi-impact data). | **XL** — add `POL-US-FEDRAMP-HIGH` seed mapping the High delta over Moderate; new 3PAO assessment cycle; FIPS 140-3 modules already declared in framework_refs but boundary needs re-attestation; US-person staffing + data-residency proofs; multi-quarter ConMon at the High cadence. |
| 18 | **StateRAMP** | StateRAMP PMO | **gap** | No mention anywhere. Adoption is rising (≈ 30 states). The control set is FedRAMP Moderate-equivalent so much of the SSP can be reused, but the authorization package is separate. | NSM (state agencies) | **L** — reuse FedRAMP Moderate control mapping; new `POL-US-STATERAMP` seed; new sponsoring-agency / ConMon path; no third-party 3PAO reuse possible. |
| 19 | **FISMA** | 44 U.S.C. §3551 | **partial (umbrella)** | The FedRAMP Moderate seed already references the underlying NIST 800-53 Rev 5 control families (`framework_refs` line 190); FISMA is the statutory umbrella that authorizes the 800-53 baseline for federal systems. We don't carry a dedicated `POL-US-FISMA-*` row. Cleanup not a gap per se. | NSM | **S** — add a `POL-US-FISMA` row that simply cross-references the existing FedRAMP Moderate row, for procurement-questionnaire clarity. |
| 20 | **NIST SP 800-171 / CMMC L1–L2** | NIST SP 800-171 Rev 3 + 32 C.F.R. Part 170 (CMMC) | **gap** | No mention anywhere. NIST 800-171 is the CUI baseline for non-federal systems; CMMC is its DoD assessment regime. L1 is self-attested; L2 requires a C3PAO. Material only if NSM (or NSI) takes a DoD prime/sub contract handling Controlled Unclassified Information. | NSM (DoD), NSI (defense primes) | **L** for L1 (self-attested baseline mapping + policy seed); **XL** for L2 (C3PAO assessment + maturity proofs). |
| 21 | **IRS Pub 1075** | IRS Publication 1075 | **gap** | No mention anywhere. Required to handle Federal Tax Information (FTI). Material only if NSM takes a contract that touches FTI (e.g. state tax administration). | NSM | **L** — `POL-US-IRS-1075` seed, additional encryption + access-logging audit events, ASRA filing surface. |
| 22 | **CJIS Security Policy v6.0** | FBI CJIS Division | **gap** | No mention anywhere. Required for systems that receive Criminal Justice Information from the FBI / state CJIS systems agency. Material only if NSM (or JRX) takes such a contract. | NSM, JRX | **L** — `POL-US-CJIS-5.x` seed, US-person personnel + advanced-authentication enforcement on the CJIS surface, audit-log retention extension. |
| 23 | **EAR** (Export Administration Regulations) | 15 C.F.R. Parts 730–774 (BIS) | **gap** | No mention anywhere. Affects any cross-border movement of "dual-use" technology — for us, that is realistically only the model artifacts and the SDK source if a future fine-tuned model is classified ECCN. | NSI (defense / export-controlled industries), platform | **M** — `POL-US-EAR-734.4` seed (de minimis / encryption export classification ECCN 5D002); deemed-export attestation for foreign-national engineers; outbound-traffic policy for model artifacts. Mostly process/legal, light code surface. |
| 24 | **ITAR** | 22 C.F.R. Parts 120–130 (DDTC) | **out-of-scope** | We do not handle defense articles or technical data on the USML. Reclassify only if a defense-industry NSI customer demands a cleared enclave. Out-of-scope today. | n/a | n/a |

## 4. Security frameworks (industry / standards)

| # | Framework | Citation | Status | Justification | SKU demand | Effort |
|---|---|---|---|---|---|---|
| 25 | **NIST CSF 2.0** | NIST CSF 2.0 (2024-02) | **partial** | Already documented as `partial` in `15-us-compliance-matrix-2026-05-14.md` row 7 ("No dedicated CSF policy seed yet"). The `framework_refs` arrays on the FedRAMP + SOC 2 seeds carry the underlying control mapping; `13-us-compliance-status-2026-05-13.md:45` calls NIST CSF 2.0 "demo-ready". | All US SKUs | **S** — add `POL-US-NIST-CSF-2` seed that cross-references existing FedRAMP / SOC 2 rows under the six CSF Functions (GV, ID, PR, DE, RS, RC). |
| 26 | **NIST AI RMF 1.0** | NIST AI 100-1 | **gap** | No mention anywhere in `src/services/compliance/`. The safety-pipeline (`src/services/safety-pipeline.ts`) already implements many of the operational controls (govern / map / measure / manage) but they are not declared against the AI RMF. Material because government RFPs and SOC 2 + AI questionnaires increasingly cite it. | NSM, NSI | **M** — `POL-US-NIST-AI-RMF` seed mapping safety-pipeline + HITL gates + bias-checker to the four Functions; no new code. |
| 27 | **PCI-DSS v4.0.1** | PCI SSC | **partial (declarative)** | One declarative reference in `scripts/nv-seed-internal-security.ts:115` (`framework_refs:['SOC2-TSC:CC4.1','PCI-DSS:11.3']`) and an enum constant in `src/services/safety-pipeline.ts:187`. **We do not store cardholder data** (Stripe / RevenueCat handle PAN tokenisation), so we are SAQ-A or SAQ-A-EP at most. No QSA attestation, no ROC, no `POL-US-PCI-*` seed. | NSPM (firm card payments), platform billing | **S** for documentation-only / SAQ-A clarity + a `POL-US-PCI-DSS-4-SAQ-A` seed; **L** if a future feature stores card data ourselves (would require segmentation and CDE controls). |
| 28 | **HITRUST CSF** | HITRUST Alliance | **gap** | No mention anywhere. Often required by health-system customers as a higher bar than HIPAA. We meet most of the underlying controls via SOC 2 + HIPAA seeds, but HITRUST is a paid certification with its own assessor. | NSI (healthcare) | **XL** — full readiness program + HITRUST AB assessor. Recommend deferring until ≥ 1 healthcare-system NSI customer signs a contract demanding it. |
| 29 | **NYDFS 23 NYCRR 500** | NY Dept. of Financial Services | **partial** | Declaratively referenced in `scripts/nv-seed-internal-security.ts:62,93` and `scripts/nv-seed-policies.ts:102` (framework_refs). **No dedicated `POL-US-NYDFS-500-*` seed and no §500.17 incident-reporting flow.** Material only if NSI is sold to a NYDFS-covered entity (NY-licensed bank / insurer / broker-dealer). | NSI | **M** — `POL-US-NYDFS-500.7` seed (MFA), `POL-US-NYDFS-500.17` seed (72-hour incident notice), NYDFS recipient set in `nv-breach-notice-service.ts`. |
| 30 | **CIS Controls v8** | Center for Internet Security | **out-of-scope (covered-by-mapping)** | Procurement teams that ask for CIS v8 are normally satisfied by the SOC 2 + ISO 27001 control map. Recommend declaring CIS v8 as "covered-via-mapping" in the matrix rather than seeding a separate policy. | NSI | n/a (documentation only). |

## 5. Out-of-scope by design

These come up in compliance questionnaires but do not apply to Nyayavigya's surface today and should not be implemented speculatively:

- **ITAR** — no USML defense articles (see #24).
- **NJ Daniel's Law** — no judge-residence first-party data (see #16).
- **GLBA Title V — Privacy Rule (16 C.F.R. Part 313 / Reg P)** — we are not a "financial institution" under GLBA; we are a service provider. Customer obligation, not ours. (We pick up Safeguards Rule under #1 because that runs on service providers as well.)
- **CCPA — sensitive personal information additional disclosures (CPRA add-on)** — already covered by the CCPA seed; called out so reviewers don't double-count.
- **SOC 1 / SSAE 18** — only relevant if customers' financial-statement auditors need ICFR coverage. Not requested today; SOC 2 covers the security trust services criteria they actually ask about.
- **State biometric laws beyond IL BIPA (TX CUBI, WA HB 1493)** — no private right of action and no breach-notice trigger; the BIPA gate (`src/middleware/nv-bipa-consent-gate.ts`) is jurisdiction-checked and TX/WA can be added to that gate's allow-list with a one-line change if a customer asks. Not a meaningful gap until then.

---

## 6. Prioritized shortlist (top 5 recommended for follow-up tasks)

Ordered by enterprise/government SKU demand × proximity to existing surfaces (cheap wins first, FedRAMP High deferred until we have an NSM customer requiring it).

### #1 — GLBA Safeguards Rule (16 C.F.R. Part 314)
**Why first.** NSI and NSPM both have customers that hold financial-services data, and the FTC Safeguards Rule has been actively enforced (revised 2023). We already declare GLBA in three config files but enforce nothing — that gap is a credibility risk on enterprise security questionnaires. **Implementation sketch.** Add `POL-US-GLBA-314.4` (designated coordinator + risk assessment) and `POL-US-GLBA-314.5` (incident notice ≥ 500 consumers within 30 days) seeds in `src/services/compliance/nv-policy-engine.ts` mirroring the NY SHIELD seed shape; extend `RECIPIENTS` in `src/services/compliance/nv-breach-notice-service.ts` with an `FTC` block that matches the §314.5 reporting form; add a `framework_refs` row on the existing SOC 2 CC6.1 internal-security seeds in `scripts/nv-seed-internal-security.ts`. **Effort: M.** No new tables, no new middleware, no third-party attestation.

### #2 — State privacy quintet (CTDPA · UCPA · TDPSA · OCPA · DPDPA-DE)
**Why second.** Five state privacy acts are now in force that we mention nowhere in `nv-policy-engine.ts`. Each of the five maps almost cell-for-cell to the existing VCDPA / CPA seeds (`nv-policy-engine.ts:100-128`), so this is a single PR that adds five seeds + five `regulator-monitor-service.ts` probe rows + five `framework_refs` references on the existing privacy attestation. **Implementation sketch.** Copy the VCDPA seed five times, edit citation + jurisdiction abbreviation + statute-specific quirks (UCPA has no profiling opt-out; TDPSA has the no-SMB-carveout note; DPDPA-DE needs a code-comment disambiguating from `POL-IN-DPDPA-*`); add CT-OAG / UT-DCP / TX-OAG / OR-DOJ / DE-DOJ probe rows in `regulator-monitor-service.ts:149-170`; one new row in `15-us-compliance-matrix-2026-05-14.md` § 2 per state. **Effort: S.**

### #3 — NIST AI RMF 1.0 + NIST CSF 2.0 declarative mapping
**Why third.** Both are zero-implementation, all-mapping wins. Government RFPs (NSM) and AI-procurement questionnaires (NSI / NSP) increasingly cite them; we already enforce most of the underlying controls (safety pipeline, HITL gates, bias-checker, hash-chain, RLS) but do not declare the mapping. **Implementation sketch.** Two new seeds in `nv-policy-engine.ts` whose `framework_refs` arrays cross-link to existing FedRAMP / SOC 2 / safety-pipeline controls. Add a section to `15-us-compliance-matrix-2026-05-14.md` § 7 making the claim explicit. **Effort: S** for both combined.

### #4 — HITECH §164.408 + §164.406 breach-notification surface
**Why fourth.** HIPAA Privacy Rule is already covered (`POL-US-HIPAA-164.502`), but the breach pipeline doesn't yet route notifications to the HHS Secretary or trigger §164.406 media notice for breaches affecting > 500 residents of a state. NSI healthcare deployments need this for substantive HIPAA defensibility, not just declarative coverage. **Implementation sketch.** Add `HHS_SECRETARY` and `HIPAA_MEDIA` recipient blocks to `RECIPIENTS` in `src/services/compliance/nv-breach-notice-service.ts` (the file already implements the NY + MA recipient pattern); add `POL-US-HIPAA-164.408` seed; cross-link from the existing `POL-US-HIPAA-164.502` row's framework_refs. **Effort: S–M.** No new tables.

### #5 — NYDFS 23 NYCRR 500 §500.7 + §500.17 enforcement surface
**Why fifth.** Already declaratively referenced on three internal-security seeds, but no dedicated policy + no 72-hour incident-notice path. Required as soon as NSI lands a NY-licensed financial-services customer; small surface area to implement. **Implementation sketch.** Two seeds in `nv-policy-engine.ts` (`POL-US-NYDFS-500.7` for MFA + access controls, `POL-US-NYDFS-500.17` for 72-hour notice); a `NYDFS_SUPERINTENDENT` recipient block in `nv-breach-notice-service.ts`; one row in `regulator-monitor-service.ts:149-170` for NYDFS. **Effort: M.**

**Deferred shortlist (deliberate).**

- **FedRAMP High** (#17): defer until an NSM agency requires it — XL effort with multi-quarter 3PAO cycle. Don't pre-build.
- **StateRAMP** (#18): defer until a state agency requires it — L effort and shares much of FedRAMP Moderate's SSP, but not until there's pull.
- **CMMC L2** (#20): defer until a DoD prime contract is in flight — requires C3PAO assessor.
- **HITRUST CSF** (#28): defer until a healthcare system explicitly demands it.
- **COPPA** (#2): defer unless NYM opens to under-13 users — current ToS gates at 13+, so the framework is non-binding.
- **FERPA** (#3): defer unless NSA is sold into a US "educational agency or institution" receiving DoE funds.
- **CJIS** (#22), **IRS Pub 1075** (#21): defer unless NSM contract appears.

---

## 7. Reading the evidence column

Every "evidence" path in §1–§4 above resolves at the time of writing:

- `src/services/compliance/nv-policy-engine.ts` — read lines 41–311 for the seed array; rows 1–11 are US.
- `src/services/regulatory-monitor/regulatory-monitor-service.ts:149-170` — US regulator catalogue.
- `src/middleware/nv-jurisdiction-binding-middleware.ts:105-128` — US jurisdiction profile (currency, courts, statutes, mandatory disclosure).
- `src/middleware/nv-bipa-consent-gate.ts` — pre-flight gate pattern reusable by COPPA / FERPA / NYDFS gates.
- `src/services/compliance/nv-breach-notice-service.ts` — `RECIPIENTS.NY_*` and `RECIPIENTS.MA_*` blocks reusable for HHS / NYDFS / FTC.
- `config/agent-registries/Nyayavigya-Legal-registry-US.json:256-300` — `regulatoryBodies` + `keyStatutes` arrays used by the agent system prompt.
- `src/services/jurisdiction-agents/usa-agents-generator.ts` — agent-tag declarations of CTDPA / UCPA (gap rows 7–8).
- `src/config/{nyv-sdk-production-config,platform-config}.ts` and `src/services/nv-system-prompt-engine.ts:121` — declarative-only mentions of GLBA / COPPA / FERPA driving the partial verdicts.
- `scripts/nv-seed-internal-security.ts`, `scripts/nv-seed-policies.ts`, `scripts/nv-seed-compliance-catalog.ts` — declarative `framework_refs` mentions of NYDFS-500 + PCI-DSS driving the partial verdicts.
- `docs/canonical/13-us-compliance-status-2026-05-13.md`, `docs/canonical/15-us-compliance-matrix-2026-05-14.md` — companion canonical docs that this analysis aligns with.

---

## 8. Out of scope of this document

- Implementing any policy seed, middleware, or attestation (this is analysis only).
- Non-US regimes.
- Customer-specific gap requests (those should become their own targeted tasks).
- Re-validating the existing "covered" claims in the matrix — that's the job of the matrix doc.

The five recommended shortlist items in § 6 are the natural follow-up tasks. Each is a single, narrowly-scoped PR that fits the existing seed / middleware / breach-notice patterns.
