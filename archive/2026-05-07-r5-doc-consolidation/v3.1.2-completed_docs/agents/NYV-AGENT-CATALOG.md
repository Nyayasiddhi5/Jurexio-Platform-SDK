---
status: completed
version: 3.1.2
superseded_by: null
last_verified: 2026-04-25
---
# Nyayavigya Platform 3.1.2 — Legal Agent Catalog

**Document Reference**: NYV-AGENTS-312-001
**Total Agents**: 452 | **Categories**: 29 | **Jurisdictions**: IN, AE, SA, SG, US, EU

---

## Agent ID Format

```
NYV-AGT-{CATEGORY}-{NNN}
```

All agents are stored in `src/data/nv-agents-registry.json` and seeded into `nv_agents`.

---

## Agent Categories

| # | Category Key | Code | Count | Legal Domain |
|---|-------------|------|-------|-------------|
| 1 | `civil_law` | CIVIL | 28 | CPC 1908, Order VII–XXIII, Suits, Decrees |
| 2 | `criminal_law` | CRIMINAL | 31 | IPC 1860, CrPC 1973, Evidence Act |
| 3 | `bns` | BNS | 15 | Bharatiya Nyaya Sanhita 2023 |
| 4 | `bnss` | BNSS | 12 | Bharatiya Nagarik Suraksha Sanhita 2023 |
| 5 | `constitutional_law` | CONSTITUTIONAL | 18 | Articles 12–368, Writs, Fundamental Rights |
| 6 | `corporate_law` | CORPORATE | 24 | Companies Act 2013, SEBI, NCLT |
| 7 | `tax_law` | TAX | 22 | GST, Income Tax Act, Customs, Excise |
| 8 | `ipr` | IPR | 16 | Patents Act, Trademarks, Copyright Act |
| 9 | `family_law` | FAMILY | 19 | HMA, Succession Act, Guardianship |
| 10 | `labor_law` | LABOR | 20 | Labour Codes 2020, Factories Act, ESI |
| 11 | `banking_law` | BANKING | 15 | RBI Act, SARFAESI, IBC, FEMA |
| 12 | `land_revenue` | LAND | 18 | Land Acquisition Act, RERA, Forest Act |
| 13 | `consumer_protection` | CONSUMER | 12 | Consumer Protection Act 2019, NCDRC |
| 14 | `environmental_law` | ENV | 11 | EPA 1986, NGT Act, Wildlife Protection |
| 15 | `cyber_law` | CYBER | 14 | IT Act 2000, DPDP Act 2023, Cybercrime |
| 16 | `nri_legal` | NRI | 10 | NRI property, OCI card, FEMA, Tax treaties |
| 17 | `arbitration` | ARB | 13 | Arbitration & Conciliation Act 1996 |
| 18 | `insolvency` | IBC | 12 | IBC 2016, NCLT, Resolution Plans |
| 19 | `securities_law` | SEC | 11 | SEBI Act, LODR, Insider Trading Regulations |
| 20 | `competition_law` | COMP | 9 | Competition Act 2002, CCI Orders |
| 21 | `media_law` | MEDIA | 8 | Press Laws, Defamation, Contempt of Court |
| 22 | `immigration_law` | IMM | 10 | Foreigners Act, Passports Act, Visa Rules |
| 23 | `maritime_law` | MARITIME | 7 | Merchant Shipping Act, Admiralty Act |
| 24 | `aviation_law` | AVIATION | 6 | Aircraft Act, DGCA Regulations, UDAN |
| 25 | `education_law` | EDU | 8 | RTE Act, UGC Act, Medical Council |
| 26 | `health_law` | HEALTH | 9 | Clinical Establishments Act, NMC Act |
| 27 | `adr_mediation` | ADR | 11 | Mediation Act 2023, Lok Adalat |
| 28 | `public_interest` | PIL | 10 | PIL Filing, Writ Petitions, Habeas Corpus |
| 29 | `legal_drafting` | DRAFTING | 22 | Contracts, Agreements, Legal Notices, MOUs |

---

## Sample Agent Definitions

### NYV-AGT-CIVIL-001 — Civil Procedure Expert
- **Domain**: Civil Law
- **Statutes**: CPC 1908, Order VII Rule 1, Limitation Act 1963
- **Capabilities**: case_analysis, pleadings_drafting, procedural_advice, limitation_check
- **Languages**: en, hi, mr, ta, te
- **Tier**: solo
- **Tools**: legal_research, citation_lookup, document_draft

### NYV-AGT-CRIMINAL-001 — IPC Expert
- **Domain**: Criminal Law
- **Statutes**: IPC 1860 (Sections 1–511), CrPC 1973
- **Capabilities**: offense_analysis, bail_advice, chargesheet_review, sentencing_guide
- **Languages**: en, hi, ta, te, kn, ml
- **Tier**: solo

### NYV-AGT-BNS-001 — BNS 2023 Expert
- **Domain**: Bharatiya Nyaya Sanhita 2023
- **Statutes**: BNS 2023, BNSS 2023, BSA 2023
- **Capabilities**: bns_analysis, ipc_to_bns_mapping, new_offense_analysis
- **Languages**: en, hi
- **Tier**: solo

### NYV-AGT-CONSTITUTIONAL-001 — Constitutional Law Expert
- **Domain**: Constitutional Law
- **Statutes**: Constitution of India (Articles 12–368), Supreme Court Rules
- **Capabilities**: fundamental_rights_analysis, writ_jurisdiction, constitutional_validity
- **Languages**: en, hi
- **Tier**: plus

---

## ROMA Level System

All agents start at ROMA L1 and auto-promote based on performance:

| Level | Threshold | Capabilities Unlocked |
|-------|----------|----------------------|
| L1 | Default | Basic query + case analysis |
| L2 | 100 successful calls, >90% accuracy | Multi-step reasoning |
| L3 | 1000 calls, >95% accuracy | BMAD cluster leadership |
| L4 | 10000 calls, >98% accuracy | Auto-orchestration, meta-agent |

---

## Full Registry

The complete 452-agent registry with all fields is in:
```
src/data/nv-agents-registry.json
```

And seeded to the database via:
```bash
npm run seed:agents
```
