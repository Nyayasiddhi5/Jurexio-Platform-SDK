# Jurexio™ Module Specifications — SDK Reference Pack

Exported 21 Oct 2026 (after consolidation pass 2) for use in the Jurexio SDK repository (Cursor). © Jurexio Inc. · Confidential.

## What this pack contains

| Folder | Contents | Use it for |
| --- | --- | --- |
| `specs/` | One Markdown file per module (14) plus the Module Register | Context for engineers and for Cursor's AI: decisions, flows, compliance reasoning, screens |
| `registry/` | `gates.json`, `events.json`, `permissions.json`, `interface-contracts.json`, `constants.json` | Machine-readable inputs for code generation, validation and tests |
| `registry/schema/` | JSON Schema (draft 2020-12) for each registry | Validating the registries in CI and in the editor |
| `registry/validate.py` | Schema validation plus cross-reference checks | `pip install jsonschema && python registry/validate.py` |
| `.cursor/rules/jurexio-specs.mdc` | Cursor project rule | Tells Cursor how to use this pack |

## Authority — read before using

1. **The Claude Docs are the source of truth.** These Markdown files are exports. Change the Doc, then re-export; never edit the Markdown here.
2. **`gates.json`, `events.json` and `permissions.json` are adopted v1** (consolidation pass 2 pack + Chairman rulings 22 Oct). Run `npm run registry:validate` after edits.
3. **`interface-contracts.json` is frozen for v1.0** (BillGuard and ClientBridge): additive changes only; breaking changes need CTO approval and every consuming module owner's sign-off.
4. **`constants.json` holds locked platform constants.** Changing one is a Chairman-level decision recorded in the specs first.

## Modules

| ID | Module | Scope | Spec version | File | Source |
| --- | --- | --- | --- | --- | --- |
| M01 | MatterCore | Matter, parties, conflicts, walls, lifecycle | v1.1 | [`specs/M01-MatterCore.md`](specs/M01-MatterCore.md) | [Claude Doc](https://claude.ai/code/artifact/1a44678d-e737-4def-8797-4c5945e97e04) |
| M02 | DocVault | Documents, privilege, release, e-signature, filing | v1.1 | [`specs/M02-DocVault.md`](specs/M02-DocVault.md) | [Claude Doc](https://claude.ai/code/artifact/37f73c64-3800-422a-aca4-8c790851a91f) |
| M03 | Jurexio Engine | AI assist, HTIL review, citation checks | v1.1 | [`specs/M03-JurexioEngine.md`](specs/M03-JurexioEngine.md) | [Claude Doc](https://claude.ai/code/artifact/e9471381-b5a1-4c11-ae4e-82ec0ec0b80b) |
| M04 | LexGraph | Authority Corpus and firm knowledge; LRM data | v1.1 | [`specs/M04-LexGraph.md`](specs/M04-LexGraph.md) | [Claude Doc](https://claude.ai/code/artifact/91226478-bad8-4b41-8303-fa0387b330fc) |
| M05 | DeadlineGuard | Court deadlines, tasks, hearings | v1.1 | [`specs/M05-DeadlineGuard.md`](specs/M05-DeadlineGuard.md) | [Claude Doc](https://claude.ai/code/artifact/0c3b6c22-d02a-45a4-86e3-bced76ea6175) |
| M06 | BillGuard | Billing, spend, client-money visibility, Jurexio Pay editions | v1.0 | [`specs/M06-BillGuard.md`](specs/M06-BillGuard.md) | [Claude Doc](https://claude.ai/code/artifact/668c93d6-47a4-4343-b580-7cb1dffb37d5) |
| M07 | RegRadar | Compliance, regulatory change, screening | v1.1 | [`specs/M07-RegRadar.md`](specs/M07-RegRadar.md) | [Claude Doc](https://claude.ai/code/artifact/4fe380bb-87ad-4635-a8c4-121aa78a711a) |
| M08 | ClientBridge | Client and stakeholder portal, location compliance | v1.0 | [`specs/M08-ClientBridge.md`](specs/M08-ClientBridge.md) | [Claude Doc](https://claude.ai/code/artifact/08713ed2-aa2f-4250-a239-2870bae84206) |
| M09 | Jurexio Ledger | Audit chain, evidence, retention, erasure | v1.1 | [`specs/M09-JurexioLedger.md`](specs/M09-JurexioLedger.md) | [Claude Doc](https://claude.ai/code/artifact/44b66db8-166f-40dd-8be1-7fc05d7f7de4) |
| M10 | NexusConnect | External boundary, connectors, egress residency | v1.1 | [`specs/M10-NexusConnect.md`](specs/M10-NexusConnect.md) | [Claude Doc](https://claude.ai/code/artifact/a41021c6-fbd2-4ab6-850e-16805424f9ec) |
| M11 | CommandCentre | Organisation, identity, permissions, governance | v1.1 | [`specs/M11-CommandCentre.md`](specs/M11-CommandCentre.md) | [Claude Doc](https://claude.ai/code/artifact/afa687a6-3360-415d-88a3-bb82112881b5) |
| M12 | PulseComms | Notifications and client-communication delivery | v1.1 | [`specs/M12-PulseComms.md`](specs/M12-PulseComms.md) | [Claude Doc](https://claude.ai/code/artifact/51fc4128-2abe-4582-9210-9d178d726b63) |
| M13 | CloudVault | Storage of record, keys, recovery, disposal | v1.1 | [`specs/M13-CloudVault.md`](specs/M13-CloudVault.md) | [Claude Doc](https://claude.ai/code/artifact/4709f3c1-d33a-4cf6-9b98-662cbca406e5) |
| M14 | DataMigrate | Migration from legacy systems | v1.1 | [`specs/M14-DataMigrate.md`](specs/M14-DataMigrate.md) | [Claude Doc](https://claude.ai/code/artifact/75d5c117-1769-47f7-b9a2-700a987f520f) |

The [Module Register](specs/MODULE-REGISTER.md) holds names, renames and design order. Design order is not the engineering sequence, which the CTO publishes.

## Platform rules every module follows

- **Jurisdictions:** India and the US (all states) are live in v1.0; UK, EU, Singapore and GCC packs are built as configuration but inactive until counsel-validated and Chairman-activated. Packs are layered: country → state → municipal → industry.
- **Gates:** every gate records approved, rejected and withdrawn outcomes; rejection needs a reason. Classes: GUARDED (requester can never approve), DUAL (two distinct people), SELF-ATTESTED (own record, with evidence, sampled).
- **AI:** agents can never act; every output affecting a matter, client or third party is human-reviewed; inference stays in-region; no tenant data trains shared models.
- **Access:** one central access decision (CommandCentre), deny by default; walls everywhere; controls are not settings.
- **Audit:** every action is logged to Jurexio Ledger; one act produces one canonical event owned by the module that owns the record.
- **UI doctrine:** status vocabulary Met / Due / At risk / Overdue / Not assessed; confidence bands 0.80 HIGH (Emerald), 0.60–0.79 MEDIUM (Gold), below 0.60 LOW (Indigo, review mandatory); AI badge Deep Indigo with Gold text.

## Registry contents (this export)

- 164 gates: 84 GUARDED, 58 DUAL, 21 SELF-ATTESTED, 1 retired (G-09-11, replaced by G-11-11).
- 759 events: 421 named in the specs, 326 generated gate outcomes (proposed convention `DOMAIN.G_NN_NN_REJECTED` / `_WITHDRAWN`), 12 legacy aliases mapped to their canonical names.
- 165 permissions: named protected permissions where the specs define them (e.g. `engine.review.approve`, `matter.waiver.approve`); others seeded as `module.g_nn_nn.decide` for the CTO to rename.
- 2 frozen interface contracts: `billguard.v1` (9 entries), `clientbridge.v1` (5 entries).

## Known limits

- Diagrams in the Docs are not included in the Markdown; each spec marks where one appears and links to the Doc.
- Event `critical` flags are `null`: the CTO sets them in Event registry v1 from each spec's "Critical-class events" list.
- The gate classes for G-09-06, G-09-08, G-09-09, G-14-06, G-14-07 and G-07-02 were assigned from register descriptions and need CTO confirmation.
- Consolidation v1.2 (21 Oct 2026) applied ClientBridge's cross-module amendments: layered packs and per-location obligations in M07, full jurisdiction stack per unit and the Location Compliance Owner and Legal Department Reviewer templates in M11, and the ClientBridge language exception in M03. The layered pack content itself is still owed by Raja Sekhar T.
