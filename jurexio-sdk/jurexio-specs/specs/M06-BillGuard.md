<!-- Source of truth: https://claude.ai/code/artifact/668c93d6-47a4-4343-b580-7cb1dffb37d5 · exported 21 Oct 2026 · do not edit here; edit the Claude Doc and re-export -->

# Module Specification — M06 BillGuard

000+632Oct 21, 2026 · @Suresh Singh

## Document control

| Field | Value |
| --- | --- |
| Module | M06 BillGuard (Billing, Spend and Financial Controls) |
| Spec version | v1.0, written to the v1.1 platform rules (PDD Review Log, 18 Oct 2026); draft for Chairman approval |
| Design order | 15 (after the infrastructure modules and LexGraph); specified ahead of pilot feedback by Chairman override |
| Engineering owner | CTO (Vamsi) |
| Jurisdiction Pack inputs | Raja Sekhar T with tax counsel (tax treatment, invoice content, numbering rules, retention, trust-account rules, unclaimed-funds rules) |
| Status | Sign-off deferred to the consolidated end review. Expect a v1.1 after pilot feedback. |

### Jurisdiction baseline

India and the United States (all states) are the only live jurisdictions in v1.0. The UK, EU, Singapore and GCC packs are built as configuration but inactive until counsel-validated and activated by the Chairman (C-01).

### Platform rules (built in)

- **Gate outcomes:** every gate records approved, rejected and withdrawn outcomes as Ledger events; rejection needs a reason; event names are generated into Event registry v1. Every gate screen shows pending, approved, rejected and withdrawn.
- **Gate classes:** GUARDED = the requester can never approve; DUAL = two distinct people; SELF-ATTESTED = an act on one's own record, with reason and evidence, logged and sampled. The locked same-actor guard governs AI output approval.
- **Approvers** are named permissions in Permission catalogue v1; "Jurexio" marks platform roles; unprefixed roles are tenant roles.
- **Canonical events:** one act, one event, owned by the module that owns the record.
- **Doctrine:** status vocabulary Met, Due, At risk, Overdue, Not assessed; confidence bands 0.80 HIGH, 0.60–0.79 MEDIUM, below 0.60 LOW (review mandatory); AI badge Deep Indigo with Gold text on every AI suggestion.

### Decision log

| ID | Locked decision |
| --- | --- |
| R1 | A neutral matter cost code replaces the UTBMS-only `billing_code`: UTBMS where required, pack or firm codes elsewhere, cost-centre codes for in-house, PSU and government tenants. Three tenant modes: law firm, in-house, public sector. The Engine never blocks on billing data; a missing code defaults to the matter's code and is flagged. |
| R2 | Client money is a connected ledger: the firm's trust bank account and trust-accounting software remain the system of record. Per-matter client-money ledger; monthly sealed three-way reconciliation signed by the finance owner and a partner; no negative client balances; dual-approved disbursement requests; Jurexio moves no money in v1.0. Integration-ready for Stripe and other payment gateways, accounting systems and finance APIs through NexusConnect governance (outside PCI card-data scope; RBI payment-data localisation for India). |
| D1 | AI suggests time from the user's own activity, with the AI badge; only the timekeeper creates an entry. An "AI-assisted" attribute drives the firm's AI billing policy. Guideline checks at entry. Billed entries locked; corrections by credit note. The same capture serves cost allocation in in-house and public-sector modes. |
| D2 | Pre-bill from confirmed entries only; checks for guidelines, budget, AI policy and client-money balance; AI narrative suggestions may never add work; Responsible Partner approval (GUARDED); pack-driven tax and gapless numbering per billing entity and jurisdiction; issued invoices locked, hashed and sealed; credit notes only; delivery through the release check; LEDES where required. |
| D3 | Outside-counsel invoices: deterministic checks plus AI flags (badge, confidence, guideline cited); a person decides every line with a reason; approval chain per tenant, with sanctioned-budget rules in public-sector mode; the outside firm sees reasons and can respond; only human-approved adjustments count as savings. |
| D4 | Rate cards versioned with effective dates, never retroactive (firm-wide DUAL: managing partner and finance owner; matter-specific: Responsible Partner). Budgets per matter and phase, threshold alerts, recorded overrun decisions, re-sanction in public-sector mode. Billing guidelines as versioned structured rules, AI-suggested and human-confirmed. Every check records the version used. All changes sealed. |
| D5 | Payments recorded or imported and matched; unapplied queue with an owner; office versus client money classified by a person; paying from client money needs client authority, dual approval and a balance check; ageing view; template reminders only after an unpaid-and-undisputed check; escalations partner-approved; no AI messages; disputes pause reminders; refunds recorded. |
| D6 | Threshold approvals: write-downs, write-ups only where the engagement allows, discounts by credit note, write-offs always DUAL with the requester excluded. Thresholds tighten only. Segregation of duties on prepare, approve and own time. Monthly DUAL period close with locked periods. Reconciled accounting export. Realisation reporting. |
| D7 | The financial ledger lives in the billing entity's region; matter narratives stay in the matter's region; cross-jurisdiction invoices carry only legally required fields into the entity region; full detail moves only with a recorded legal basis. Longest applicable retention; holds win; certified disposal. Engagement currency with exchange rate recorded at issue. |
| E1 | Jurexio Pay is written as planned editions (Section 7), not v1.0 scope: Stage 1 US fee payments via Stripe Connect; Stage 2 India via an RBI-authorised aggregator with UPI; Stage 3 trust payments and trust accounting per state after counsel sign-off; accounting by connectors, not a Jurexio general ledger. |
| Inherited | Rate cards and billing guidelines moved from CommandCentre (M11 D7). Client-money settlement and final bill are matter-closing pre-conditions (M01 D7). Client-money reconciliation is a cutover hard block (M14). AI billing follows firm policy plus the per-matter "AI prohibited" flag (M03 D7). Payment gateways on signed-client trigger (M10 R2). Invoices reach clients only through the release check (M02 D3). |

## Section 1 — Module identity

| Field | Value |
| --- | --- |
| Module | M06 BillGuard |
| Code | `jrx-billguard.ts` |
| Tagline | Every hour, rate, invoice and rupee or dollar traceable to an approved term and a named decision. |
| Job to be done | Turn legal work into accurate, guideline-compliant, tax-correct financial records, for firms that bill, in-house teams that pay outside counsel, and public bodies that account for sanctioned spend, with every adjustment approved and every figure provable. |
| Tenant modes | **Law firm:** time, invoicing, client-money visibility, collections. **In-house:** budgets, outside-counsel invoice review, spend analytics. **Public sector:** cost allocation, sanctioned budgets, approval chains. |
| Primary users | Timekeepers, Responsible Partners, finance owners and billing staff, managing partners; in-house matter owners and invoice reviewers; public-sector budget holders |
| Secondary users | Compliance Officer, auditors (time-limited), clients through ClientBridge (invoices and disputes) |
| Jurisdictions | India and the US (all states) live in v1.0 |
| AI role | Suggests time entries, narrative wording, guideline rules and outside-counsel flags, all shown with the AI badge; never creates a billable entry, approves an invoice, adjusts a line or writes a client message |

### v1.0 scope — in

- Matter cost code and default attribution for every Engine call (R1).
- Tenant modes configured in CommandCentre (R1).
- Time capture with AI suggestions, AI-assisted attribute, guideline checks and locking (D1).
- Pre-bill, checks, Responsible Partner approval, pack-driven tax and numbering, sealed invoices, credit notes, LEDES export (D2).
- Outside-counsel invoice intake (upload and email capture), deterministic checks, AI flags, line decisions, approval chains, outcome notices, honest savings (D3).
- Versioned rate cards, budgets with alerts and overrun decisions, structured billing guidelines (D4).
- Payment recording and import, matching, office and client money classification, receivables ageing, template reminders, disputes, refunds (D5).
- Per-matter client-money ledger, monthly three-way reconciliation, client-money controls (R2).
- Write-down, write-up, credit-note and write-off controls; segregation of duties; period close; accounting export; realisation reporting (D6).
- Entity-region financial ledger with cross-jurisdiction minimum fields; retention and currency rules (D7).
- Frozen interface contract for consuming modules (Section 4).

### v1.0 scope — out

Deferred items, the Jurexio Pay editions and their triggers are in Section 7.

## Section 2 — User stories

### US-06-01 Capture time without padding

As an **associate**, I need suggested time entries from my own work so that I bill what I did without reconstructing my week.

- Suggestions show the activity behind them and carry the AI badge.
- Nothing becomes an entry until I confirm or edit it.
- Entries for AI-assisted work are marked so firm policy can apply.

### US-06-02 Approve a bill that will be paid

As a **Responsible Partner**, I need every pre-bill checked against the client's guidelines, budget and AI terms so that the invoice is not rejected or disputed.

- Every failed check shows its rule and guideline version.
- I cannot approve a pre-bill I prepared.
- The issued invoice is locked, numbered without gaps and sealed.

### US-06-03 Correct a bill properly

As a **finance owner**, I need corrections made by credit note so that the tax and audit trail stays intact.

- Issued invoices can never be edited.
- Credit notes link to the original and follow the discount thresholds.

### US-06-04 Review outside counsel fairly

As an **in-house matter owner**, I need every outside-counsel invoice line checked and flagged so that I approve only what we agreed to pay.

- Rate, timekeeper, budget and expense checks run automatically; AI flags judgement items with the guideline cited.
- I decide every flagged line, with a reason the firm will see.
- Savings reports count only adjustments I approved.

### US-06-05 Stay inside a sanctioned budget

As a **public-sector budget holder**, I need alerts before spend reaches the sanctioned amount so that no overrun happens without re-sanction.

- Alerts at set thresholds; overruns need the re-sanction chain recorded.

### US-06-06 Know every client's money

As a **managing partner**, I need each matter's client-money balance reconciled monthly against the trust journal and bank so that we are always audit-ready.

- The three-way reconciliation is signed by the finance owner and a partner and sealed.
- No request can take a client's balance below zero.

### US-06-07 Never mix office and client money

As a **finance officer**, I need every receipt classified as office or client money when I record it so that funds are never mixed.

- Classification is mandatory and logged.
- Paying a fee from client money needs the client's authority and dual approval.

### US-06-08 Chase without embarrassment

As a **Responsible Partner**, I need reminders sent only for unpaid, undisputed invoices so that we never chase a client who has paid or objected.

- Reminders use firm-approved templates; disputes pause them.
- Escalated demands need my approval.

### US-06-09 Close the month cleanly

As a **finance owner**, I need a locked monthly close and a reconciled export so that our accounts and Jurexio always agree.

- Closing is dual-approved; closed periods cannot change.
- The accounting export reconciles back to BillGuard.

## Section 3 — Financial controls and key user flows

### Billing lifecycle (law-firm mode)

Confirmed time and expenses → pre-bill with checks → Responsible Partner approval → sealed invoice → release check and delivery → payment recorded and matched → period close and accounting export. In-house mode replaces the first four steps with outside-counsel intake, checks, line decisions and approval; public-sector mode adds sanctioned-budget and re-sanction rules.

> **Diagram:** Billing lifecycle, law-firm mode — rendered in the source Claude Doc: https://claude.ai/code/artifact/668c93d6-47a4-4343-b580-7cb1dffb37d5

### Pre-bill checks (D2)

| Check | Source | On failure |
| --- | --- | --- |
| Client billing guidelines (rate caps, banned tasks, staffing, block billing, expense rules) | Guideline version in force (D4) | Line flagged with the rule; must be corrected or written down with reason |
| Budget | Matter and phase budget (D4) | Alert; overrun needs a recorded decision |
| AI billing policy | Firm policy, engagement terms, "AI prohibited" flag (M03 D7) | AI-assisted lines adjusted per policy before approval |
| Client-money draw | Per-matter client-money balance (R2) | Blocked if it would take the balance below zero |
| Tax and invoice content | Jurisdiction Pack | Blocked until complete |

### Adjustment controls (D6)

| Action | Control | Class |
| --- | --- | --- |
| Write-down at pre-bill | Responsible Partner within threshold; plus finance owner above it; reason required | GUARDED, DUAL above threshold |
| Write-up | Only where the engagement allows value or fixed-fee billing; Responsible Partner with reason | GUARDED |
| Discount on an issued invoice | Credit note only; finance owner as second approver above threshold | GUARDED, DUAL above threshold |
| Write-off of a receivable | Responsible Partner and finance owner; requester excluded | DUAL |
| Reversal of a write-off | Finance owner with reason | GUARDED |

Thresholds are tenant settings that can only be tightened. Nobody approves a write-down of their own time; whoever prepares a pre-bill cannot approve it; whoever records a payment cannot approve its write-off.

### Client-money controls (R2, D5)

| Control | Rule |
| --- | --- |
| System of record | The firm's trust bank account and trust-accounting software |
| Per-matter ledger | Imported or synced, plus entries recorded under these controls |
| Classification | Every receipt classified as office or client money by a person at recording |
| No negative balances | Any request exceeding a client's balance is blocked |
| Paying fees from client money | Client authority attached, dual approval, balance check |
| Disbursement requests | Dual approval; sent to the firm's finance team, never executed by Jurexio |
| Monthly reconciliation | BillGuard ledger = trust journal = bank statement; exceptions owned; signed by finance owner and partner; sealed |
| Unclaimed balances | Pack rules at matter closing (M01 D7) |

### HTIL gate register

Every gate also records rejected and withdrawn outcomes (platform rule).

| Gate | Decision | Class | Approver role | Ledger events |
| --- | --- | --- | --- | --- |
| G-06-01 | Confirm a time entry (including from an AI suggestion) | SELF-ATTESTED | Timekeeper | `BILL.TIME_ENTRY_CONFIRMED` |
| G-06-02 | Approve a pre-bill and issue the invoice | GUARDED | Responsible Partner (preparer excluded) | `BILL.INVOICE_ISSUED` |
| G-06-03 | Approve a write-down | GUARDED; DUAL above threshold | Responsible Partner; plus finance owner | `BILL.WRITE_DOWN_APPROVED` |
| G-06-04 | Approve a write-up under the engagement | GUARDED | Responsible Partner | `BILL.WRITE_UP_APPROVED` |
| G-06-05 | Issue a credit note or discount | GUARDED; DUAL above threshold | Responsible Partner; plus finance owner | `BILL.CREDIT_NOTE_ISSUED` |
| G-06-06 | Write off a receivable | DUAL, requester excluded | Responsible Partner and finance owner | `BILL.WRITE_OFF_APPROVED` |
| G-06-07 | Reverse a write-off | GUARDED | Finance owner | `BILL.WRITE_OFF_REVERSED` |
| G-06-08 | Publish a firm-wide rate card version | DUAL | Managing partner and finance owner | `BILL.RATE_CARD_PUBLISHED` |
| G-06-09 | Set a matter-specific rate | GUARDED | Responsible Partner | `BILL.MATTER_RATE_SET` |
| G-06-10 | Confirm structured billing-guideline rules | GUARDED (uploader excluded) | Billing-guideline owner | `BILL.GUIDELINE_CONFIRMED` |
| G-06-11 | Set or revise a budget; decide an overrun | GUARDED; DUAL for public-sector re-sanction | Responsible Partner or budget holder; plus sanctioning authority | `BILL.BUDGET_APPROVED`, `BILL.BUDGET_OVERRUN_DECIDED` |
| G-06-12 | Decide an outside-counsel invoice line | GUARDED | In-house matter owner or invoice reviewer | `BILL.OC_LINE_DECIDED` |
| G-06-13 | Approve an outside-counsel invoice for payment | GUARDED; DUAL above threshold | Per tenant approval chain | `BILL.OC_INVOICE_APPROVED` |
| G-06-14 | Record and classify a receipt (office or client money) | SELF-ATTESTED, sampled | Finance officer | `BILL.RECEIPT_RECORDED` |
| G-06-15 | Apply client money to a fee invoice | DUAL, client authority attached | Responsible Partner and finance owner | `BILL.CLIENT_MONEY_APPLIED` |
| G-06-16 | Request a disbursement from client money | DUAL | Responsible Partner and finance owner | `BILL.DISBURSEMENT_REQUESTED` |
| G-06-17 | Sign off the monthly three-way reconciliation | DUAL | Finance owner and a partner | `BILL.RECONCILIATION_SIGNED` |
| G-06-18 | Send an escalated reminder or demand | GUARDED | Responsible Partner | `BILL.REMINDER_ESCALATED` |
| G-06-19 | Record a refund | GUARDED | Finance owner | `BILL.REFUND_RECORDED` |
| G-06-20 | Close a financial period | DUAL | Finance owner and managing partner | `BILL.PERIOD_CLOSED` |
| G-06-21 | Move full invoice detail across jurisdictions | DUAL, legal basis required | Responsible Partner and DPO | `BILL.INVOICE_DETAIL_TRANSFERRED` |

### Flow F1 — Time to invoice

- **Steps:** AI suggests entries from the timekeeper's activity; timekeeper confirms (G-06-01); guideline checks at entry; at billing, the pre-bill is generated from confirmed entries with the rate card in force; checks run; narrative suggestions offered with the AI badge; the Responsible Partner approves (G-06-02); tax and number applied from the pack; invoice locked, hashed, sealed; delivered through the release check; LEDES generated where required.
- **Primary act:** the Partner reads each failed check and its rule before approving.

### Flow F2 — Outside-counsel review (in-house mode)

- **Steps:** invoice arrives by upload or email capture; deterministic checks against the engagement; AI flags judgement items; the reviewer decides every flag (G-06-12); approval chain (G-06-13); outcome and reasons sent to the outside firm; the firm's response kept with the invoice.
- **Primary act:** the reviewer reads the cited guideline for each flag before deciding.

### Flow F3 — Receipt to reconciliation

- **Steps:** finance records or imports a receipt and classifies it (G-06-14); office money matched to invoices, unmatched to the unapplied queue; client money posted to the per-matter ledger; month end: trust journal and bank statement imported; three-way reconciliation; exceptions resolved; sign-off (G-06-17).
- **Primary act:** the finance owner reads every exception before signing.

### Flow F4 — Collections

- **Steps:** ageing view flags overdue invoices; the system checks unpaid and undisputed; template reminder sent through PulseComms; escalations need G-06-18; a dispute from ClientBridge or reply pauses reminders and routes to the Responsible Partner.
- **Primary act:** the Partner decides the response to a dispute.

### Flow F5 — Period close

- **Steps:** finance prepares the close; unapplied items and open approvals listed; close approved (G-06-20); period locked; journals exported to the accounting system; the export reconciled back.
- **Primary act:** the approvers read the open-items list before closing.

### Screen inventory for UX (FLAG-007)

| Screen | Flow / gate | Primary act |
| --- | --- | --- |
| SCR-06-01 My time | F1, G-06-01 | Confirm or edit suggested entries |
| SCR-06-02 Pre-bill review | F1, G-06-02 to G-06-04 | Read checks; adjust; approve |
| SCR-06-03 Invoices and credit notes | G-06-05, G-06-06 | View sealed invoices; issue credit notes; write off |
| SCR-06-04 Rates and guidelines | G-06-08 to G-06-10 | Publish rate versions; confirm guideline rules |
| SCR-06-05 Budgets | G-06-11 | Set budgets; decide overruns |
| SCR-06-06 Outside-counsel review | F2, G-06-12, G-06-13 | Decide lines; approve for payment |
| SCR-06-07 Receipts and matching | F3, G-06-14 | Record, classify and match receipts |
| SCR-06-08 Client-money ledger and reconciliation | F3, G-06-15 to G-06-17 | Review balances; reconcile; sign off |
| SCR-06-09 Receivables and collections | F4, G-06-18, G-06-19 | Read ageing; escalate; record refunds |
| SCR-06-10 Period close and export | F5, G-06-20 | Close periods; export and reconcile |
| SCR-06-11 Realisation and spend analytics | D6, D3 | Recorded versus billed versus collected; outside-counsel spend |

## Section 4 — Data architecture

### Inputs

| Source | What enters |
| --- | --- |
| Timekeepers; Jurexio activity signals | Confirmed time entries; activity for suggestions (own activity only) |
| Jurexio Engine (M03) | Matter cost reference on every call; AI-assisted markers; narrative and guideline-rule suggestions |
| MatterCore (M01) | Matter, client, engagement terms, billing arrangement, "AI prohibited" flag, Responsible Partner |
| CommandCentre (M11) | Tenant mode, units and billing entities, thresholds, approver roles |
| DocVault (M02) | Outside-counsel invoices and LEDES files from intake; client guideline documents |
| Firm finance (import, later connectors) | Trust journal, bank statements, receipts, accounting reconciliation results |
| ClientBridge (M08) | Invoice disputes and queries |
| Jurisdiction Packs | Tax rules, invoice content, numbering rules, retention, trust and unclaimed-funds rules |

### Outputs

| Destination | What exits |
| --- | --- |
| DocVault and ClientBridge | Sealed invoices, credit notes and statements through the release check |
| PulseComms (M12) | Budget alerts, approval requests, template reminders |
| Firm accounting system | Period journals (file in v1.0) |
| MatterCore (M01) | Closing status: client-money balance, final-bill status |
| DataMigrate (M14) | Opening balances and reconciliation results for cutover |
| Jurexio Ledger (M09) | Every confirmation, approval, adjustment, receipt, reconciliation and close |

### Frozen interface contract (consumed by other modules)

These fields are frozen for v1.0. Changes are additive only; a breaking change needs CTO approval and sign-off from every consuming module's owner.

| Field | Meaning | Producer | Consumers |
| --- | --- | --- | --- |
| `matter_cost_ref` | Matter ID plus code from the tenant's code set (UTBMS, pack or firm code, cost centre); defaults to the matter code when missing, with `cost_ref_defaulted = true` | BillGuard | Jurexio Engine (every call), MatterCore |
| `billing_arrangement` | Hourly, fixed fee, capped, value, contingency (where lawful), no-bill | BillGuard (set at matter opening) | MatterCore opening gate (condition 6) |
| `ai_billing_policy` | Bill, discount or do not bill AI-assisted work, per firm, client or matter | BillGuard | Jurexio Engine (attribute on outputs), BillGuard pre-bill |
| `client_money_balance` | Per-matter balance from the connected ledger, with `last_reconciled_period` | BillGuard | MatterCore closing pre-condition 2, DataMigrate cutover, ClientBridge (client view) |
| `final_bill_status` | None, issued, written off with approval | BillGuard | MatterCore closing pre-condition 3 |
| `invoice_record` | Number, entity, dates, amounts, tax fields, status (issued, part-paid, paid, disputed, credited, written off), sealed hash | BillGuard | ClientBridge, DocVault, PulseComms |
| `invoice_dispute` | Dispute flag, reason, raised-by, raised-at | ClientBridge | BillGuard (pauses reminders) |
| `rate_card_version` and `guideline_version` | Version IDs used for each entry and pre-bill | BillGuard | Ledger, audit, ClientBridge (client-facing rates where shared) |
| `budget_status` | Per matter and phase: amount, used, threshold state in the status vocabulary | BillGuard | ClientBridge (where shared), MatterCore overview |

### Core records

| Record | Key fields | Where it lives |
| --- | --- | --- |
| Time entry | Timekeeper, matter, cost code, duration, narrative, AI-assisted flag, guideline version, status, invoice link | Matter's region |
| Expense | Matter, type, amount, evidence pointer, status | Matter's region |
| Rate card version | Entity, levels, rates, currency, effective from and to, approvers | Billing entity's region |
| Guideline version | Client, structured rules, source document, confirmer | Matter's or client's region |
| Budget | Matter, phase, amount, thresholds, sanction reference (public sector), decisions | Matter's region |
| Invoice and credit note | Entity, number, lines (full detail in matter region; required fields in entity region), tax, currency and FX, hash | Per D7 |
| Outside-counsel invoice | Firm, lines, checks, flags, decisions, reasons, approvals, firm response | Matter's region |
| Receipt | Amount, date, source, classification (office or client money), matches, recorder | Billing entity's region |
| Client-money ledger entry | Matter, client, amount, type, authority, approvers | Billing entity's region |
| Reconciliation | Period, three balances, exceptions, owners, signatories, hash | Billing entity's region |
| Period | Entity, status (open, closed), closers, export hash | Billing entity's region |

### Ledger events

All events use the `BILL.` domain. Rejected and withdrawn variants of every gate event are generated into Event registry v1.

| Family | Events |
| --- | --- |
| Time | `BILL.TIME_SUGGESTED`, `BILL.TIME_ENTRY_CONFIRMED`, `BILL.TIME_ENTRY_CHANGED`, `BILL.COST_REF_DEFAULTED` |
| Invoicing | `BILL.PREBILL_CREATED`, `BILL.PREBILL_CHECK_FAILED`, `BILL.INVOICE_ISSUED`, `BILL.CREDIT_NOTE_ISSUED`, `BILL.WRITE_DOWN_APPROVED`, `BILL.WRITE_UP_APPROVED`, `BILL.WRITE_OFF_APPROVED`, `BILL.WRITE_OFF_REVERSED` |
| Terms | `BILL.RATE_CARD_PUBLISHED`, `BILL.MATTER_RATE_SET`, `BILL.GUIDELINE_CONFIRMED`, `BILL.BUDGET_APPROVED`, `BILL.BUDGET_THRESHOLD_REACHED`, `BILL.BUDGET_OVERRUN_DECIDED` |
| Outside counsel | `BILL.OC_INVOICE_RECEIVED`, `BILL.OC_LINE_FLAGGED`, `BILL.OC_LINE_DECIDED`, `BILL.OC_INVOICE_APPROVED`, `BILL.OC_OUTCOME_SENT` |
| Money | `BILL.RECEIPT_RECORDED`, `BILL.RECEIPT_MATCHED`, `BILL.CLIENT_MONEY_APPLIED`, `BILL.DISBURSEMENT_REQUESTED`, `BILL.REFUND_RECORDED`, `BILL.RECONCILIATION_SIGNED`, `BILL.RECONCILIATION_EXCEPTION` |
| Collections | `BILL.REMINDER_SENT`, `BILL.REMINDER_ESCALATED`, `BILL.DISPUTE_RECEIVED`, `BILL.DISPUTE_RESOLVED` |
| Period | `BILL.PERIOD_CLOSED`, `BILL.EXPORT_GENERATED`, `BILL.EXPORT_RECONCILED`, `BILL.INVOICE_DETAIL_TRANSFERRED` |

**Critical-class events:** invoice issue, credit notes, write-offs, client-money application, disbursement requests, reconciliation sign-off, period close, cross-jurisdiction transfer.

The April events `BILLING.TIME_ENTRY`, `BILLING.INVOICE_GENERATED` and `BILLING.INVOICE_APPROVED` map to `BILL.TIME_ENTRY_CONFIRMED`, `BILL.PREBILL_CREATED` and `BILL.INVOICE_ISSUED`.

### Residency

- The financial ledger (invoices' required fields, receipts, client-money ledger, reconciliations, periods, journals) lives in the billing entity's region.
- Matter work detail (time narratives, expense evidence, full invoice lines) stays in the matter's region.
- Where entity and matter jurisdictions differ, only legally required fields cross; full detail needs G-06-21.

## Section 5 — Compliance requirements

India and the US are the live jurisdictions in v1.0; tax and record rules come from their packs and must be validated by tax counsel before go-live.

### Regulations and standards, and how M06 satisfies them

| Regulation / standard | Requirement | How M06 satisfies it |
| --- | --- | --- |
| ABA Model Rule 1.5 and state versions | Reasonable fees; communicating the basis and changes of fees | Versioned rate cards, never retroactive; rate-change notice where the engagement requires; guideline and AI-policy checks at pre-bill (D2, D4) |
| ABA Model Rule 1.15 and state trust-account rules | Separate client funds; per-client records; reconciliation; record retention | Connected client-money ledger, no negative balances, person-classified receipts, monthly sealed three-way reconciliation (R2, D5) |
| Advocates Act 1961 and BCI conduct rules | Fees and proper accounting of clients' money | Same controls under the India pack |
| Indian GST law (including reverse charge on specified legal services; e-invoicing where thresholds apply; record retention) | Correct tax treatment and invoice content | Pack-driven tax rules, invoice content and numbering; gapless sequence per entity (D2) |
| Companies Act 2013 and accounts rules (India) | Books of account retained and accessible in India, with India-located backups | Financial ledger in the billing entity's region; retention per pack (D7) |
| Income-tax record-keeping (India); US federal and state tax record rules; state sales tax on legal services where it applies | Retain records; charge tax where due | Pack retention and tax rules; longest applicable period (D7) |
| Consumer debt-collection rules where they apply to individual clients | Fair, accurate collection communications | Template reminders only after unpaid-and-undisputed checks; escalations partner-approved; no AI messages (D5) |
| DPDP Act; state privacy laws | Personal data in billing records | Minimum fields across jurisdictions; matter detail stays home (D7) |
| SOC 2 (CC5 control activities; CC8 change management) | Segregation of duties; controlled changes | Threshold approvals, SoD, period locks, versioned terms (D4, D6) |
| PCI DSS; RBI payment aggregator and localisation rules | Card data security; licensed payment handling | Out of scope in v1.0 (no money movement); Jurexio Pay editions designed to stay out of card-data scope and use licensed providers (Section 7) |
| LEDES and UTBMS standards | Client e-billing formats and codes | LEDES export and UTBMS code sets where clients require (R1, D2) |

### Mandatory HTIL steps (never automated)

- Confirming every time entry (G-06-01) and approving every invoice (G-06-02).
- Every write-down, write-up, credit note, write-off and reversal (G-06-03 to G-06-07).
- Publishing rates, setting matter rates, confirming guideline rules, setting budgets and deciding overruns (G-06-08 to G-06-11).
- Every outside-counsel line decision and payment approval (G-06-12, G-06-13).
- Classifying receipts, applying client money, requesting disbursements, signing reconciliations (G-06-14 to G-06-17).
- Escalated reminders, refunds, period close and cross-jurisdiction transfers (G-06-18 to G-06-21).

### Decisions that must remain human

- What is billed, at what rate, and what is written down or off.
- Whether an outside firm's charge is accepted.
- Whether money is office or client money, and whether client money may be used.
- What a client is told about payment.

### Approved claims language

- "Every invoice checked against the client's guidelines and approved by a partner before it goes out."
- "Client money reconciled three ways, every month, with sealed sign-off."
- "Outside-counsel savings counted only when your reviewer approves them."
- Prohibited: "trust accounting system", "handles client funds", "AI billing", "automatic savings", and any payment-processing claim before a Jurexio Pay edition is live.

## Section 6 — Module dependencies

### Upstream (M06 depends on)

| Dependency | What M06 needs |
| --- | --- |
| Jurexio Ledger Core (M09) | Event sealing, including critical financial events |
| CommandCentre (M11) | Tenant mode, billing entities as units, thresholds, approver roles (finance owner, managing partner, invoice reviewer, budget holder, billing-guideline owner) |
| MatterCore (M01) | Matters, clients, engagement terms, Responsible Partner, "AI prohibited" flag, home jurisdiction |
| Jurexio Engine (M03) | Activity signals for time suggestions; narrative, guideline-rule and outside-counsel flag suggestions under its gates |
| DocVault (M02) | Intake of outside-counsel invoices and guideline documents; storage and release of invoices |
| PulseComms (M12) | Alerts, approval requests, template reminders |
| CloudVault (M13) | Entity-region and matter-region storage; retention and certified disposal |
| NexusConnect (M10) | File imports in v1.0; later accounting, payment and e-billing connectors |
| Jurisdiction Packs | Tax, invoice content, numbering, retention, trust and unclaimed-funds rules |

### Downstream (depend on M06)

See the frozen interface contract in Section 4.

| Module | Dependency |
| --- | --- |
| MatterCore (M01) | Billing arrangement at opening; client-money balance and final-bill status at closing |
| DataMigrate (M14) | Opening balances and three-way reconciliation before cutover |
| Jurexio Engine (M03) | `matter_cost_ref`; AI billing policy |
| ClientBridge (M08) | Invoices, statements, budget status where shared; dispute intake |
| RegRadar (M07) | Client-money evidence for the firm compliance check |

### External integrations

| Integration | v1.0 | Later (signed-client trigger, NexusConnect governance) |
| --- | --- | --- |
| Accounting systems (e.g. Tally, QuickBooks, Xero, SAP) | File export and reconciliation | Live connectors |
| Trust accounting software and bank statements | File import | Live feeds |
| E-billing platforms used by corporate clients | LEDES file generation | Direct submission |
| Payment providers | None | Jurexio Pay editions (Section 7) |
| Tax e-invoicing systems where mandated | Pack-defined fields and file output | Direct submission where required |

### Agent touchpoints

Through the Jurexio Engine only: time-suggestion, narrative-suggestion, guideline-extraction and invoice-review agents. Every output is a suggestion with the AI badge; none can create an entry, approve, adjust, or send.

## Section 7 — v1.0 scope, planned editions and deferred scope

The v1.0 feature list is in Section 1. India and the US are live in v1.0.

### v1.0 build increments

| Increment | Contents | Needed by |
| --- | --- | --- |
| Financial Core | Matter cost code, tenant modes, billing arrangement at matter opening, frozen interface contract, rate cards, client-money ledger import and balance | MatterCore opening and closing gates; Engine calls; DataMigrate cutover |
| Billing | Time capture and suggestions, pre-bill checks, approvals, pack tax and numbering, sealed invoices, credit notes, LEDES, adjustments and controls | First law-firm client going live |
| In-house and public sector | Outside-counsel intake and review, approval chains, budgets and sanctions, spend analytics | First in-house or public-sector client |
| Money and close | Receipts, matching, classification, three-way reconciliation, collections, period close, accounting export | First month-end after go-live |

### Jurexio Pay: planned editions

Not v1.0 scope. Each edition is released on a signed-client trigger, after NexusConnect platform approval (M10 D1), residency checks (M10 D2), and counsel review where stated. Jurexio never holds or routes funds: money settles directly to the firm's own account through a regulated provider.

| Edition | Scope | Provider model | Conditions before release |
| --- | --- | --- | --- |
| Stage 1 — US fee payments | Online payment of fee invoices (office money only), automatic matching to sealed invoices, receipts | Stripe Connect, with each firm as a connected account and payouts direct to the firm; Jurexio may earn a platform fee | Hosted payment pages and tokens so Jurexio stays outside card-data scope; refund and chargeback handling against the firm's operating account |
| Stage 2 — India fee payments | The same experience, including UPI | An RBI-authorised payment aggregator (Stripe's India onboarding is invite-only today, so it cannot be relied on) | RBI payment-data localisation; India region processing; GST-compliant receipts |
| Stage 3 — Trust payments and trust accounting | Card and bank payments into trust accounts; full trust ledger, disbursements and statutory reports | A provider and configuration proven to keep fees and chargebacks off trust funds | Counsel sign-off per US state (and India pack); state-specific reports; independent review before Jurexio becomes any system of record for client money |
| Accounting connectors | Live sync with Tally, QuickBooks, Xero, SAP and similar | NexusConnect connectors | Reconciliation stays mandatory; Jurexio does not become a general ledger |

### Release testing

- **No AI billing:** no suggestion becomes a time entry, invoice change, adjustment or message without a person.
- **Guarded approval:** a pre-bill cannot be approved by its preparer; write-offs cannot be approved by the requester.
- **Locked records:** issued invoices, billed entries and closed periods cannot be edited through any route.
- **Gapless numbering:** invoice numbers per entity and jurisdiction have no gaps or duplicates, including after failures.
- **Never retroactive:** a rate change never alters entries or invoices dated before it.
- **Client money:** no request can take a balance below zero; receipts cannot be saved without classification; client money cannot pay a fee without authority and dual approval.
- **Reconciliation:** a period with an unresolved three-way exception cannot be signed off.
- **Collections:** reminders never go for paid or disputed invoices.
- **Engine independence:** an Engine call with no cost code proceeds with the default and is flagged.
- **Residency:** cross-jurisdiction invoices place only required fields in the entity region.
- **Contract stability:** every field in the frozen interface contract is present and typed as specified.

### Deferred scope

| Feature | Release trigger | Reason |
| --- | --- | --- |
| Jurexio Pay Stages 1–3 | Signed client, with the conditions above | v1.0 moves no money (R2) |
| Direct submission to client e-billing platforms | Signed corporate client using a specific platform | LEDES files cover v1.0 |
| Live accounting and bank connectors | Signed client | File import and export cover v1.0 |
| Profitability and partner-compensation modelling beyond realisation | Pilot feedback | Realisation reporting first |

### Rejected (not deferred)

| Option | Reason |
| --- | --- |
| UTBMS mandatory on every Engine call | Blocks India and non-billing institutions (R1) |
| Jurexio as trust-accounting system of record in v1.0 | Regulated liability before counsel review (R2) |
| AI-created time entries | Misrepresentation risk on client bills (D1) |
| Editable issued invoices | Fails tax and audit integrity (D2) |
| AI auto-adjusting outside-counsel invoices | Commercial decisions stay human (D3) |
| AI-written collection messages | Contradicts PulseComms R1 (D5) |
| A Jurexio general ledger | A separate product category; integrate instead |

## Section 8 — Open questions and blockers

### Gating item (read first)

BillGuard was specified before pilot feedback by Chairman override. Billing practice varies most of any module across clients, so the first three pilots should be run against this spec deliberately, and a v1.1 issued from what they show. The frozen interface contract in Section 4 is protected from that rework.

### Decisions requiring Chairman or CTO input

| # | Question | Owner | Recommendation |
| --- | --- | --- | --- |
| OQ-06-01 | Default write-down, discount and outside-counsel approval thresholds | Chairman | Set conservatively per tenant mode; tenants may only tighten |
| OQ-06-02 | Which tenant mode each of the first three pilots runs | Chairman | At least one law firm and one in-house or public-sector pilot, so both halves are tested |
| OQ-06-03 | Task-code sets for India (no UTBMS equivalent) | Raja Sekhar T | A short pack-provided code set per practice area, extendable by firms |
| OQ-06-04 | Whether to seek a Jurexio Pay Stage 1 launch client in the US | Chairman | Yes, once BillGuard v1.0 is live with a US firm; it adds revenue and retention |
| OQ-06-05 | India payment aggregator shortlist for Stage 2 | CTO with procurement | Shortlist RBI-authorised aggregators with UPI and India-only data processing |
| OQ-06-06 | Reminder cadence defaults | Chairman | First reminder at 14 days overdue, second at 30, escalation thereafter |

### Compliance validations pending

- [ ] GST treatment of legal services, including reverse charge and e-invoicing applicability, encoded in the India pack (tax counsel).
- [ ] US state sales-tax applicability for pilot states (tax counsel).
- [ ] Books-of-account location and retention periods (India), and tax and trust record periods (pilot US states).
- [ ] Trust-account reconciliation frequency and reporting rules for pilot US states.
- [ ] Unclaimed client-funds rules per pilot jurisdiction.
- [ ] Consumer debt-collection rules for individual clients in pilot jurisdictions.

### Items blocking engineering start

- [ ] Chairman sign-off (consolidated end review).
- [ ] Frozen interface contract reviewed by the owners of MatterCore, DataMigrate, the Engine and ClientBridge.
- [ ] Event registry v1 and Permission catalogue v1 (CTO, P0) including the `BILL.*` events and G-06 permissions.
- [ ] Billing entities modelled as CommandCentre units with region and currency.
- [ ] Gapless numbering design that survives failures and concurrency.

### Housekeeping

- [ ] Replace "every SDK call must carry a valid UTBMS billing code" in the Architecture Spec with the matter cost code rule (R1).
- [ ] Replace "LEDES 2000B" demo labels with the formats confirmed per client.
- [ ] Remove "AI invoice review" claims that imply automatic adjustment.
