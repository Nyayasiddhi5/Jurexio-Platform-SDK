<!-- Source of truth: https://claude.ai/code/artifact/91226478-bad8-4b41-8303-fa0387b330fc · exported 21 Oct 2026 · do not edit here; edit the Claude Doc and re-export -->

# Module Specification — M04 LexGraph

Oct 18, 2026 · @Suresh Singh

## Document control

| Field | Value |
| --- | --- |
| Module | M04 LexGraph (Authority Corpus and Institutional Knowledge) |
| Spec version | v1.1, consolidated after the PDD Review Log (18 Oct 2026); draft for Chairman approval |
| Design order | After the three infrastructure modules; last module before pilot feedback |
| Engineering owner | CTO (Vamsi) |
| Content owners | Jurexio legal content team per country; Raja Sekhar T (coverage declarations, transitional rules, counsel validation) |
| Status | Sign-off deferred to the consolidated end review. No engineering start before sign-off. |

### Strategic context

Jurexio is building its own LRM, with country-specific small language models (SLMs), retrieval (RAG) and country-specific corpus databases. LexGraph's Authority Corpus is the foundation of that programme: versioned, source-hashed, per-country law that is lawful to train on. Licensed databases may be connected for the time being but are not required.

### Jurisdiction baseline

India and the United States (all states) are the only live jurisdictions in v1.0, so the live country corpora in v1.0 are India and the US. The United Kingdom, European Union, Singapore and GCC packs are built as configuration but inactive until counsel-validated and activated by the Chairman (C-01, 18 Oct 2026; supersedes the earlier six-active baseline); their corpora are built and declared as each is activated.

### Decision log

| ID | Locked decision |
| --- | --- |
| R1 | Two separate stores. A shared, read-only Authority Corpus of public law (the only source for citation verification), maintained by Jurexio. A private Institutional Knowledge store per tenant, under the access decision and walls. Firm knowledge may cite the law; the law never references firm knowledge. Never merged; nothing crosses tenants. |
| D1 | Per-country Authority Corpus built from official sources first. Licensed databases optional and transitional, only where the licence permits AI use. Declared coverage per jurisdiction (court, reporter, statute set, date range). "Not found" only inside declared coverage; outside it, "Unverifiable". Every item source-linked and hashed. |
| D7 | Shared LRM and country SLMs trained only on the Authority Corpus, plus licensed content only where training is expressly licensed. Never trained on tenant documents, matter data, prompts, outputs, reviewer edits, institutional knowledge, communications or personal data. Aggregate quality signals only. Versioned, provenance-logged datasets. Registry gate and in-region hosting. Tenant-private models deferred. |
| D2 | Statutory status deterministic from legislation. Case treatment only where sourced (corpus passage or licensed citator). AI-proposed treatment verified by the content team before display. Never a "good law" badge: "No negative treatment found in Jurexio's corpus as of \[date\], not a complete citator". The Engine flags sourced negative treatment. |
| D3 | Promotion workflow: lawyer proposes; blocked if the engagement forbids reuse; AI-suggested, human-confirmed anonymisation; knowledge-owner approval, plus conflicts reviewer for walled-matter content; scoped visibility with walls; flagged when cited law changes; re-review dates; withdrawable and traceable. |
| D4 | Institutional indexes per tenant, per region, under tenant keys. Matter retrieval only in the home region. Public Authority Corpus and public-law SLMs replicated to the query's region, so client queries never leave home; licensed content only where its licence allows. Unavailable where lawful replication is not possible. Index access logged. |
| D5 | AI enrichment (summaries, headnotes, propositions, links) always labelled as a research aid with paragraph links. Citation checks and quotations use source text only, with character-level quote matching. Evaluation before release, content-team sampling, user error reporting. Becomes reviewed work once in a draft or output. Tenant enrichment private. |
| D6 | Point-in-time corpus: every provision versioned with effective dates and official sources; partial or uncertain commencement flagged. Matter relevant dates drive research, drafting and citation checks, with the date shown. Transitional regime set by the Jurisdiction Pack. DeadlineGuard rule versions linked. Treatment dated. |
| Inherited | Citation verification (Engine D3). Retrieval mirrors permissions; institutional knowledge only through promotion (Engine D5). Only officially confirmed regulatory changes enter (RegRadar D7). In-region inference (Engine D1). Walls everywhere (MatterCore D5). |

### Consolidation v1.1 (PDD Review Log, 18 Oct 2026)

**Platform rules applied to this specification**

- **Gate outcomes (CB-ENG-06, CB-DES-05):** every gate records approved, rejected and withdrawn outcomes as Ledger events; rejection needs a reason; the gate engine generates the `_REJECTED` and `_WITHDRAWN` event names into Event registry v1. Every gate screen shows pending, approved, rejected and withdrawn.
- **Gate classes (I-05):** GUARDED = the requester can never approve; DUAL = two distinct people; SELF-ATTESTED = an act on one's own record, with reason, evidence and step-up where stated, logged and sampled by Compliance. The locked same-actor guard governs AI draft approval.
- **Approvers (C-02, CB-ENG-04):** every approver role maps to named permissions in Permission catalogue v1. "Jurexio" marks platform roles; unprefixed roles are tenant roles.
- **Canonical events (C-07, C-15):** one act produces one canonical event, owned by the module that owns the record; other context goes in attributes.
- **Design order (C-13):** the order specs were designed, not the engineering sequence, which the CTO publishes.
- **Doctrine carried in (CB-DES-03, CB-DES-04):** confidence bands 0.80 and above HIGH (Emerald), 0.60–0.79 MEDIUM (Gold), below 0.60 LOW (Indigo, human review mandatory); AI badge Deep Indigo with Gold text on every enrichment and suggestion.

**Gate classes in this module**

| Class | Gates |
| --- | --- |
| GUARDED | G-04-03, G-04-04, G-04-06 (proposer confirms; knowledge owner re-checks every redaction at G-04-07), G-04-07, G-04-08, G-04-09, G-04-10 |
| DUAL | G-04-01, G-04-02, G-04-05 |
| SELF-ATTESTED | None |

**Module changes**

- **C-01:** India and US corpora are the live v1.0 scope; other corpora follow activation.
- **C-05:** the five citation verdicts here are the platform-wide set used by the Engine's citation panel.
- **CB-CMP-01:** citation checks and index access recorded in the Engine's sub-chain stay individually retrievable; the Compliance Officer holds a named permission to view sub-chains (hashes and metadata), within the three-click rule.
- **BQ-19 (accepted):** initial coverage = apex and high courts, key statutes, and the forums of the first three pilots.

## Section 1 — Module identity

| Field | Value |
| --- | --- |
| Module | M04 LexGraph |
| Code | `jrx-lexgraph.ts` |
| Tagline | The law as it stood, from the source, for every country, and each firm's knowledge sealed inside the firm. |
| Job to be done | Provide a versioned, source-verified corpus of each country's law that grounds every AI answer and citation check, and a private, governed store of each firm's own knowledge that only that firm can use. |
| Platform role | The authority of record for citation verification; the training and retrieval foundation for Jurexio's LRM and country SLMs; the home of each tenant's institutional knowledge |
| Primary users | Lawyers (research), knowledge owners (promotion approvals), Jurexio content team (corpus, treatment, enrichment quality) |
| Indirect users | Every Engine request that retrieves or verifies law |
| AI role | Enrichment (summaries, propositions, links) as labelled research aids; suggested anonymisation and treatment links, all verified by people; never an authority |

### v1.0 scope — in

**Authority Corpus**

- Per-country corpora for India and the US (the live jurisdictions) from official sources, with declared coverage per court, reporter, statute set and date range (D1).
- Optional licensed sources only where AI use is licensed (D1).
- Point-in-time versioning of provisions with commencement, amendment and repeal links (D6).
- Statutory status and sourced case treatment; content-team verification of AI-proposed treatment (D2).
- Labelled AI enrichment with paragraph links; source-text-only citation and quotation checks (D5).
- Citation verification service for the Engine, with coverage-dependent verdicts (D1, Engine D3).
- Replication of public corpora and public-law SLMs to query regions where lawful (D4).
- Training-dataset governance for the LRM and country SLMs (D7).

**Institutional Knowledge**

- Per-tenant, per-region store and indexes under tenant keys (D4).
- Promotion workflow with reuse check, anonymisation, approvals, scoped visibility, change flags, re-review and withdrawal (D3).
- Retrieval governed by the access decision and walls (Engine D5, MatterCore D5).

### v1.0 scope — out

Deferred items and triggers are in Section 7.

## Section 2 — User stories

### US-04-01 Research the law as it stood

As a **litigator**, I need research results to reflect the law in force on my matter's relevant date so that I never apply today's law to a past transaction.

- Results show the provision version in force on the matter's date, and the date used.
- Partial or uncertain commencement is flagged.

### US-04-02 Trust a "Not found"

As a **Partner**, I need "Not found" to mean the citation is genuinely absent from a source Jurexio fully covers so that a real authority is never wrongly blocked.

- "Not found" appears only for citations inside declared coverage.
- Citations outside coverage are marked "Unverifiable" and must be opened.
- I can see each country's declared coverage.

### US-04-03 Know when law has changed

As an **associate**, I need repeals and negative treatment shown with their sources so that I do not cite superseded law.

- Repealed provisions show what replaced them and from when.
- Case treatment appears only where a source shows it, with the passage linked.
- No "good law" badge is ever shown.

### US-04-04 Quote accurately

As a **litigator**, I need every quotation in an AI draft matched to the source text so that I never file an invented quotation.

- Quotes are compared character by character with the judgment or statute.
- Any unmatched quote is flagged before review.

### US-04-05 Reuse our best work safely

As a **knowledge owner**, I need to approve anonymised precedents before the firm reuses them so that our knowledge grows without exposing clients.

- Promotion is blocked where the engagement forbids reuse.
- Every suggested redaction is confirmed by a person.
- Items are flagged for review when the law they cite changes.

### US-04-06 Keep our knowledge ours

As a **General Counsel**, I need our firm's knowledge invisible to every other firm and never used to train shared models so that our work stays ours.

- Institutional knowledge lives in our own encrypted index in our region.
- No tenant data trains any shared Jurexio model.

### US-04-07 Research foreign law without exporting facts

As a **Mumbai lawyer** researching English law, I need my query processed in India so that client facts never leave the country.

- The public English-law corpus and model run inside the India region.
- If lawful replication is not possible, research is shown as unavailable here.

### US-04-08 Fix the corpus when it is wrong

As a **lawyer**, I need to report an error in a summary or link so that the corpus improves for everyone.

- Reports reach the content team, which corrects and logs the fix.

## Section 3 — Knowledge controls and key user flows

### Two stores (R1)

|  | Authority Corpus | Institutional Knowledge |
| --- | --- | --- |
| Contents | Statutes, regulations, judgments, official guidance per country | Promoted clauses, templates, memos, research notes |
| Visibility | All tenants (read-only) | One tenant only, within scopes and walls |
| Maintained by | Jurexio content team | The tenant's knowledge owners |
| Role in citation checks | The only authority of record | Never an authority |
| May train shared models | Yes, where sources permit (D7) | Never |
| Links | Referenced by firm knowledge | May cite the corpus; never cited by it |

> **Diagram:** Two stores, two sets of rules — rendered in the source Claude Doc: https://claude.ai/code/artifact/91226478-bad8-4b41-8303-fa0387b330fc

### Citation verdicts (D1, Engine D3)

| Situation | Verdict | Effect in review |
| --- | --- | --- |
| Found in source text; quote matches character for character | Verified | No block |
| Inside declared coverage, not found | Not found | Hard block until removed or source attached |
| Outside declared coverage | Unverifiable | Must be opened before approval |
| Found, but quoted text does not match the source | Quote mismatch | Flagged; treated like Not found for the quotation |
| Found, with sourced negative treatment or repeal | Negative treatment | Must be opened before approval |

### Treatment display (D2)

| Case | Shown as |
| --- | --- |
| Statute repealed or substituted | "Repealed from \[date\]; see \[replacement\]" with official source |
| Case expressly overruled, reversed or doubted in a corpus judgment | "Negative treatment" with the linking passage |
| Licensed citator treatment (where licensed) | Treatment with the licensor named |
| Nothing found | "No negative treatment found in Jurexio's corpus as of \[date\], not a complete citator" |

### Promotion workflow (D3)

| Step | Who | Rule |
| --- | --- | --- |
| 1 Propose | Lawyer on the source matter | Item, jurisdiction, practice area, cited authorities |
| 2 Reuse check | System | Blocked if the engagement forbids reuse of work product |
| 3 Anonymise | Engine suggests; proposer confirms every redaction (G-04-06) | Matter reference removed |
| 4 Approve | Knowledge owner; plus conflicts reviewer for walled-matter content (G-04-07) | Dual where walled |
| 5 Publish | System | Scoped to tenant, units or groups; walls apply |
| 6 Maintain | Knowledge owner (G-04-08) | Flagged when cited law changes; re-review date; withdrawable |

### Point-in-time rules (D6)

- Every provision has effective-from and effective-to dates, with the official commencement, amendment or repeal source.
- Partial or uncertain commencement is flagged, never assumed.
- Matters carry relevant dates set in MatterCore; research, drafting and citation checks use the version in force on that date and display it.
- Transitional rules (which regime applies) come from the Jurisdiction Pack, validated by counsel.
- DeadlineGuard rule versions reference the corpus versions they encode.

### HTIL gate register

Gate classes are listed under Consolidation v1.1 in Document control. Model deployment uses Engine G-03-09.

| Gate | Decision | Gate type | Approver role | Ledger events |
| --- | --- | --- | --- | --- |
| G-04-01 | Publish or change a country's declared coverage | Dual distinct | Jurexio content lead and counsel reviewer for that jurisdiction | `PLATFORM.COVERAGE_PUBLISHED` |
| G-04-02 | Add or remove a corpus source, recording its AI-use and training rights | Dual distinct | Jurexio content lead and Jurexio Compliance | `PLATFORM.CORPUS_SOURCE_APPROVED`, `PLATFORM.CORPUS_SOURCE_REMOVED` |
| G-04-03 | Verify or reject an AI-proposed treatment link | Single approver | Content reviewer qualified in that jurisdiction | `LEXGRAPH.TREATMENT_VERIFIED`, `LEXGRAPH.TREATMENT_REJECTED` |
| G-04-04 | Publish a provision version or commencement status | Single approver | Content reviewer qualified in that jurisdiction | `LEXGRAPH.PROVISION_VERSIONED` |
| G-04-05 | Approve a training dataset version | Dual distinct | Jurexio CTO and Jurexio Compliance | `PLATFORM.DATASET_APPROVED` |
| G-04-06 | Confirm anonymisation of a promoted item | Proposer confirms each redaction; knowledge owner re-checks at G-04-07 | Proposing lawyer | `LEXGRAPH.ANONYMISATION_CONFIRMED` |
| G-04-07 | Approve promotion of an item | Single approver; dual distinct for walled-matter content | Knowledge owner; plus conflicts reviewer | `LEXGRAPH.KNOWLEDGE_PROMOTED` |
| G-04-08 | Withdraw or re-certify an item | Single approver | Knowledge owner | `LEXGRAPH.KNOWLEDGE_WITHDRAWN`, `LEXGRAPH.KNOWLEDGE_RECERTIFIED` |
| G-04-09 | Correct enrichment after an error report | Single approver | Content reviewer | `LEXGRAPH.ENRICHMENT_CORRECTED` |
| G-04-10 | Approve replication of a corpus or public-law model to another region | Single approver, licence check required | Jurexio Compliance | `PLATFORM.CORPUS_REPLICATED` |

### Flow F1 — Corpus ingestion

- **Steps:** official or licensed source retrieved; text stored with source link, retrieval date and hash; provisions versioned with dates (G-04-04); coverage declaration updated (G-04-01); enrichment generated and labelled; treatment proposals queued for verification (G-04-03).
- **Primary act:** the content reviewer checks versions and treatment against the official text.

### Flow F2 — Citation verification

- **Steps:** the Engine sends citations and quotations with the matter's relevant date; LexGraph checks each against the source text in force on that date and the declared coverage; returns a verdict per citation (table above).
- **Primary act:** the reviewer opens Unverifiable and Negative-treatment items in the Engine review screen.

### Flow F3 — Research

- **Steps:** a lawyer queries the corpus from a matter; retrieval runs in the matter's home region over the replicated public corpus and the tenant's own knowledge index; results show versions in force on the matter's date, sourced treatment and labelled enrichment.
- **Primary act:** the lawyer reads the source text behind any summary before relying on it.

### Flow F4 — Promotion

- **Steps:** as in the promotion table; published items appear in the tenant's knowledge search; changes in cited law raise review flags.
- **Primary act:** the knowledge owner reads the anonymised item against its redaction list before approving.

### Flow F5 — Training dataset and model release

- **Steps:** dataset assembled only from approved corpus sources with training rights; dataset version approved (G-04-05); model trained in a controlled environment; evaluated on the country set; deployed through the Engine model registry gate (G-03-09) to the in-region host.
- **Primary act:** the approvers read the dataset manifest, including every source's training right.

### Screen inventory for UX (FLAG-007)

| Screen | Flow / gate | Primary act |
| --- | --- | --- |
| SCR-04-01 Research | F3 | Search law by date; read source text, versions and treatment |
| SCR-04-02 Provision view | F3, D6 | Read a provision's versions, commencement and replacements |
| SCR-04-03 Coverage | D1, G-04-01 | See what each country corpus covers |
| SCR-04-04 Firm knowledge | F3, F4 | Search and use promoted items |
| SCR-04-05 Promotion workspace | F4, G-04-06, G-04-07 | Propose, anonymise, approve |
| SCR-04-06 Knowledge review queue | G-04-08 | Review flagged and due items; withdraw or re-certify |
| SCR-04-07 Report an error | US-04-08 | Report a wrong summary, link or version |
| SCR-04-08 Content console (Jurexio) | F1, F5, G-04-01 to G-04-05, G-04-09, G-04-10 | Manage sources, versions, treatment, datasets and replication |

## Section 4 — Data architecture

### Inputs

| Source | What enters |
| --- | --- |
| Official sources per country (via NexusConnect) | Statutes, regulations, judgments, gazette notifications, official guidance |
| Licensed sources (optional, via NexusConnect) | Content and citator data, only where AI use (and, for training, training) is licensed |
| RegRadar (M07) | Officially confirmed regulatory changes |
| DocVault and MatterCore | Source items proposed for promotion; engagement reuse terms; matter relevant dates |
| Jurexio Engine (M03) | Citation and quotation verification requests; enrichment drafts; treatment proposals |
| Users | Error reports |
| Jurisdiction Packs | Coverage declarations, transitional rules |

### Outputs

| Destination | What exits |
| --- | --- |
| Jurexio Engine (M03) | Citation verdicts; source text for retrieval; enrichment as labelled aids |
| DeadlineGuard (M05) | Provision versions referenced by rule sets; change flags |
| LRM and SLM training (Jurexio) | Approved training dataset versions (corpus only) |
| Lawyers | Research results, provision histories, treatment, firm knowledge |
| Jurexio Ledger (M09) | Coverage, source, version, treatment, promotion, dataset and replication events |

### Core records

| Record | Key fields | Where it lives |
| --- | --- | --- |
| Source | Country, publisher, type (official or licensed), AI-use right, training right, licence reference | Platform |
| Coverage declaration | Country, courts, reporters, statute sets, date ranges, version | Platform |
| Document | Source, retrieval date, hash, jurisdiction, forum code | Country corpus |
| Provision version | Instrument, provision, text, effective from and to, commencement status, source, replaced-by link | Country corpus |
| Treatment link | From and to documents, type, passage, status (proposed or verified), verifier | Country corpus |
| Enrichment | Document, type (summary, proposition, link), model version, paragraph references, label | Country corpus |
| Training dataset | Version, included sources and documents, rights per source, approvers | Platform (controlled environment) |
| Knowledge item | Tenant, type, anonymised text, cited authorities, scope, owner, re-review date, status | Tenant region |
| Promotion record | Source matter (sealed reference), reuse check, redactions confirmed, approvers | Tenant region |

### Training governance (D7)

- Only sources with a recorded training right may enter a training dataset; official public-law sources qualify; licensed sources only where the contract expressly permits training.
- No tenant data of any kind can be selected into a dataset; the dataset builder has no access path to tenant stores.
- Each dataset version and each model version are linked, so every model can be traced to exactly what it learned from.
- Models deploy only through the Engine's evaluation and registry gate, and are hosted in-region.

### Residency and isolation (D4)

- Country corpora are public law and may be replicated to any region where they are needed (G-04-10), licensed content only where its licence allows.
- Client queries and matter retrieval run only in the matter's home region, over the replicated public corpus and the tenant's own index.
- Institutional knowledge indexes are per tenant, per region, encrypted under the tenant key, and destroyed with it on exit.

### Ledger events

| Domain | Events |
| --- | --- |
| `LEXGRAPH.` | `LEXGRAPH.DOCUMENT_INGESTED`, `LEXGRAPH.PROVISION_VERSIONED`, `LEXGRAPH.TREATMENT_PROPOSED`, `LEXGRAPH.TREATMENT_VERIFIED`, `LEXGRAPH.TREATMENT_REJECTED`, `LEXGRAPH.ENRICHMENT_PUBLISHED`, `LEXGRAPH.ENRICHMENT_CORRECTED`, `LEXGRAPH.ERROR_REPORTED`, `LEXGRAPH.CITATION_VERIFIED`, `LEXGRAPH.KNOWLEDGE_PROPOSED`, `LEXGRAPH.REUSE_BLOCKED`, `LEXGRAPH.ANONYMISATION_CONFIRMED`, `LEXGRAPH.KNOWLEDGE_PROMOTED`, `LEXGRAPH.KNOWLEDGE_FLAGGED`, `LEXGRAPH.KNOWLEDGE_RECERTIFIED`, `LEXGRAPH.KNOWLEDGE_WITHDRAWN`, `LEXGRAPH.INDEX_ACCESSED` |
| `PLATFORM.` | `PLATFORM.COVERAGE_PUBLISHED`, `PLATFORM.CORPUS_SOURCE_APPROVED`, `PLATFORM.CORPUS_SOURCE_REMOVED`, `PLATFORM.DATASET_APPROVED`, `PLATFORM.CORPUS_REPLICATED` |

**Critical-class events:** coverage publication, source approval, dataset approval, knowledge promotion and withdrawal, reuse blocks.

`LEXGRAPH.CITATION_VERIFIED` and `LEXGRAPH.INDEX_ACCESSED` are recorded within the Engine's agent-step sub-chain (Ledger D11) rather than as separate top-level events.

## Section 5 — Compliance requirements

India and the US are the live jurisdictions in v1.0, so the obligations below apply through their packs; rows for other jurisdictions apply when those packs are activated. Rights to reuse legal texts differ by country and must be confirmed per source before ingestion and before training.

### Regulations and standards, and how M04 satisfies them

| Regulation / standard | Requirement | How M04 satisfies it |
| --- | --- | --- |
| Copyright status of legal texts (e.g. US federal works and the US government-edicts doctrine; India's Copyright Act provisions on reproducing Acts and judgments; UK Crown copyright and open licences for legislation and judgments; EU reuse rules for EUR-Lex; Singapore, GCC terms to be confirmed) | Lawful reproduction and reuse | Source records carry AI-use and training rights per source; only approved sources ingested (G-04-02) |
| Licence terms of commercial databases | Use only within licensed purposes | Licensed content optional; AI use and training only where expressly licensed (D1, D7) |
| Text and data mining rules (e.g. EU copyright directive exceptions and opt-outs; UK limits) | Lawful training on content | Training rights recorded per source; datasets approved (G-04-05) |
| Data protection laws (GDPR, UK GDPR, DPDP, PDPA, GCC) | Personal data in judgments; transfers; minimisation | Public corpus processed under counsel-confirmed bases; statutory anonymity respected; client data never in the shared corpus or training (D7) |
| Statutory anonymity rules (e.g. protected identities of victims and minors) | Never reveal protected identities | Corpus preserves court anonymisation; enrichment and links never de-anonymise |
| ABA Model Rules 1.1 and 3.3; court rules on accurate citation | Competence; no false statements of law | Coverage-dependent verdicts, quote matching, point-in-time versions (D1, D5, D6) |
| ABA Model Rule 1.6; BCI, SRA and other confidentiality rules; outside-counsel reuse terms | Protect client information; honour reuse restrictions | Per-tenant knowledge, reuse check, human-confirmed anonymisation (D3, D4) |
| EU AI Act (obligations for providers of AI models placed on the EU market) | Documentation of training data and model governance | Versioned datasets with provenance; model-to-dataset traceability (D7); applicability to Jurexio's LRM confirmed by counsel |
| ISO/IEC 42001 | Data provenance and quality for AI systems | Source hashing, dataset approval, evaluation before release (D5, D7) |

### Mandatory HTIL steps (never automated)

- Publishing coverage and approving sources (G-04-01, G-04-02).
- Verifying every AI-proposed treatment link (G-04-03) and publishing provision versions (G-04-04).
- Approving training datasets (G-04-05) and deploying models (Engine G-03-09).
- Confirming every anonymisation redaction and approving promotions (G-04-06, G-04-07).
- Withdrawing or re-certifying knowledge (G-04-08); correcting enrichment (G-04-09).
- Approving replication to another region (G-04-10).

### Decisions that must remain human

- What a provision says and when it was in force.
- Whether a case has been overruled or doubted.
- Whether a firm's work may be reused, and whether it is safely anonymised.
- What Jurexio's models may learn from.

### Approved claims language

- "Your work never trains our models."
- "Every citation checked against the official text in force on your matter's date, within declared coverage."
- "Each country's law, versioned and sourced."
- Prohibited: "complete citator", "good law guaranteed", "covers all case law", any coverage not in the published declaration, and any claim that institutional knowledge improves shared models.

## Section 6 — Module dependencies

### Upstream (M04 depends on)

| Dependency | What M04 needs |
| --- | --- |
| NexusConnect (M10) | Connectors to official sources and optional licensed sources |
| CloudVault (M13) | Per-country corpus storage; per-tenant encrypted indexes; replication to approved regions |
| CommandCentre (M11) | Access decisions, walls, knowledge-owner and content-reviewer roles |
| MatterCore (M01) | Engagement reuse terms; matter relevant dates; walled-matter status |
| RegRadar (M07) | Officially confirmed regulatory changes |
| Jurisdiction Packs | Coverage declarations, transitional rules |
| Jurexio Ledger Core (M09) | Event sealing |

### Downstream (depend on M04)

| Module | Dependency |
| --- | --- |
| Jurexio Engine (M03) | Citation and quote verification; retrieval; models trained on the corpus |
| DeadlineGuard (M05) | Provision versions behind forum rule sets |
| DocVault (M02) | Pre-filing citation checks |
| RegRadar (M07) | Authorities linked to obligations |
| Jurexio LRM and country SLMs | Training datasets |

### Sequencing

The Engine's citation claim ("every citation verified or explicitly confirmed by a lawyer") cannot be made for a jurisdiction until that country's corpus and coverage declaration are published. The Engine can go live earlier with every citation outside coverage treated as Unverifiable, which keeps review safe but slower.

### Agent touchpoints

Through the Jurexio Engine only: enrichment, treatment proposals, anonymisation suggestions and retrieval. Every agent output in M04 is either a labelled research aid or a proposal verified by a person.

## Section 7 — v1.0 scope vs deferred scope

The v1.0 feature list is in Section 1. India and the US are live in v1.0; each other country's corpus goes live when its pack is activated and its coverage is published.

### v1.0 build increments

| Increment | Contents | Needed by |
| --- | --- | --- |
| Corpus Core | Source management with rights, ingestion with hashing, point-in-time provision versions, coverage declarations, citation and quote verification service | Engine citation checks per jurisdiction |
| Research and treatment | Statutory status, sourced treatment with verification queue, labelled enrichment, error reporting, in-region replication, research screens | Lawyer research at go-live |
| Firm knowledge | Per-tenant indexes, promotion workflow with reuse check and anonymisation, change flags, re-review and withdrawal | First tenant wishing to build knowledge |
| Model pipeline | Training-dataset governance and approval, model-to-dataset traceability, handover to the Engine registry gate | Jurexio LRM and country SLM releases |

### Release testing

- **Coverage-dependent verdicts:** a real citation outside coverage is never marked Not found; a seeded fake citation inside coverage always is.
- **Quotes:** altered quotations of real authorities are flagged.
- **Point in time:** a query on a 2019 matter returns the 2019 version of a provision and shows the date used.
- **Repeals:** repealed provisions show their replacement and date.
- **No good-law badge:** no screen or output states that law is good.
- **Training isolation:** the dataset builder cannot reach any tenant store; a dataset containing an unlicensed source cannot be approved.
- **Tenant isolation:** one tenant's knowledge never appears in another tenant's results, under any query.
- **Residency:** a foreign-law query from a matter never leaves the matter's home region.
- **Promotion:** items from engagements forbidding reuse cannot be promoted; unconfirmed redactions block approval.
- **Change flags:** repealing a cited provision flags every knowledge item that cites it.

### Deferred scope

| Feature | Release trigger | Reason |
| --- | --- | --- |
| Tenant-private adapted models | Signed client, with its own design and deletion guarantees | Keeps shared models free of tenant data (D7) |
| Full citator coverage | Licensed citator with AI-use rights, or corpus maturity | Treatment shown only where sourced (D2) |
| Coverage beyond published declarations | Content team capacity per country | Coverage grows by declaration, never by implication (D1) |
| Public research product outside tenant matters | Product decision | v1.0 serves matters and tenants |

### Rejected (not deferred)

| Option | Reason |
| --- | --- |
| One combined graph | A labelling error becomes a breach or a false authority (R1) |
| "Not found" regardless of coverage | Would wrongly block real citations (D1) |
| Training shared models on client work | Confidentiality, privilege and erasure risk (D7) |
| AI-inferred "good law" status | Unverifiable and dangerous when wrong (D2) |
| Shared vector index across tenants | One filter bug exposes another firm's knowledge (D4) |
| Sending client queries to foreign regions for research | Cross-border transfer of client data (D4) |
| Current-law-only corpus | Wrong for historical questions (D6) |

## Section 8 — Open questions and blockers

### Gating item (read first)

The country corpora are a large, continuous content operation: sourcing, versioning, commencement tracking, treatment verification and enrichment review, for six jurisdictions and their sub-national law. It needs a funded content team per country with qualified reviewers, and a published coverage plan. The Engine's citation claim, DeadlineGuard's rule sets and the LRM programme all depend on it.

### Decisions requiring Chairman or CTO input

| # | Question | Owner | Recommendation |
| --- | --- | --- | --- |
| OQ-04-01 | Initial coverage plan per country (which courts, reporters, statute sets and years first) | Chairman with Raja Sekhar T | Start with apex and high courts, central and key state statutes, and the forums of the first three pilot clients |
| OQ-04-02 | Size and structure of the legal content team per country | Chairman | Named lead per country plus qualified reviewers; budgeted as a standing function |
| OQ-04-03 | Which licensed databases, if any, to connect in the interim | Chairman with procurement | Only those whose contracts permit AI use; training rights negotiated separately |
| OQ-04-04 | Re-review period for institutional knowledge items | Chairman | 12 months, sooner when cited law changes |
| OQ-04-05 | Who are the knowledge owners in each client firm | Client firm, in CommandCentre | One per practice area, set at onboarding |
| OQ-04-06 | Naming and governance of the LRM and country SLM programme within the model registry | CTO | Each country model registered per jurisdiction like any other model (Engine D1, D8) |

### Compliance validations pending

- [ ] Reuse and training rights for official legal texts in each of the six jurisdictions (counsel).
- [ ] Lawful basis for processing personal data contained in public judgments, per jurisdiction.
- [ ] Applicability of EU AI Act model-provider obligations to Jurexio's LRM if offered in the EU.
- [ ] Statutory anonymity rules per jurisdiction encoded in ingestion.

### Items blocking engineering start

- [ ] Chairman sign-off (consolidated end review).
- [ ] Source register with rights recorded for each country's first sources.
- [ ] Point-in-time data model agreed with DeadlineGuard (shared provision versions).
- [ ] Per-tenant index design under CloudVault tenant keys.
- [ ] Controlled training environment with no access path to tenant stores.

### Housekeeping

- [ ] Retire "LexGraph — Institutional Knowledge Graph" as a single store in the Architecture diagram; show the two stores.
- [ ] Remove any "good law" or "complete citator" wording from demos.
- [ ] Add "Your work never trains our models" to approved messaging once counsel confirms the training controls.
