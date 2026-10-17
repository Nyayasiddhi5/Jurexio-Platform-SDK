# SOC2 tenant boundary — Jurexio vs JRX

| Tenant | System | Keys | Evidence |
|--------|--------|------|----------|
| Jurexio Enterprise | This repo, `/jurexio/*` SSM | `JRX_SDK_KEY_*` | Separate change log, CI brand gate |
| Jurexio India | JRX monorepo, jrx-prod | `JRX_SDK_KEY_*` | Unchanged by Jurexio program |
| Legacy partner JRX | JRX gateway tenant | `JRX_SDK_KEY_JRX` | Documented as **not** Enterprise |

No cross-tenant key reuse in production.
