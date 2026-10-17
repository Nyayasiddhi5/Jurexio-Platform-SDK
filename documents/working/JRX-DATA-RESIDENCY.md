# JRX data residency

| Region | Jurexio | India NYV (upstream) |
|--------|---------|----------------------|
| Primary compute | US/EU (staging/prod TBD) | ap-south-1 |
| App DB | `jurexio` Postgres | `nyayavigya` — **no shared access** |
| Search corpus | `jrx_caselaw_us` | India caselaw — **not replicated** |

Customer data for Jurexio Enterprise stays in Jurexio-controlled accounts only.
