# SOC2 tenant boundary — Jurexio vs NYV

| Tenant | System | Keys | Evidence |
|--------|--------|------|----------|
| Jurexio Enterprise | This repo, `/jurexio/*` SSM | `JRX_SDK_KEY_*` | Separate change log, CI brand gate |
| Nyayavigya India | NYV monorepo, nysdev | `NYV_SDK_KEY_*` | Unchanged by Jurexio program |
| Legacy partner JRX | NYV gateway tenant | `NYV_SDK_KEY_JRX` | Documented as **not** Enterprise |

No cross-tenant key reuse in production.
