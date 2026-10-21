# JRX jurisdiction template packs (Phase B)

**Canonical starter packs:** `shared/jurisdiction-templates/{IN,US,UK,EU,SG,GC}/*.json`

| Jurisdiction | Starter template | SDK / API |
|--------------|------------------|-----------|
| **IN** | Bail application (BNSS) | `TemplatesApi` + orchestrate with `jurisdiction: IN` |
| **US** | Federal civil complaint | Same with `jurisdiction: US` |
| **UK** | Part 7 claim form | `jurisdiction: UK` |
| **EU** | Cross-border claim | `jurisdiction: EU` |
| **SG** | Originating claim | `jurisdiction: SG` |
| **GC** | Commercial claim | `jurisdiction: GC` |

**Env:** `JRX_TEMPLATE_PACKS_DIR` may point at `shared/jurisdiction-templates` for custom deploys.

## Phase C — US / IN filing

- **US:** enable `JRX_US_PACER_ENABLED=1` + `JRX_EFILING_USE_ADAPTERS=1` — adapter `src/services/e-filing/adapters/us-pacer-adapter.ts`
- **IN:** enable `JRX_IN_ECOURTS_ENABLED=1` + `JRX_EFILING_USE_ADAPTERS=1` — `in-ecourts-adapter.ts`

Court credentials are operator-supplied (never in git).

## Phase B — US corpus

Run `bash scripts/jrx-us-corpus-ingest-stub.sh` until full ingest pipeline is scheduled.
