# JRX data residency

| Region | Jurexio | India JRX (upstream) |
|--------|---------|----------------------|
| Primary compute | US/EU (staging/prod TBD) | ap-south-1 |
| App DB | `jurexio` Postgres | `jurexio` — **no shared access** |
| Search corpus | `jrx_caselaw_us` | India caselaw — **not replicated** |

Customer data for Jurexio Enterprise stays in Jurexio-controlled accounts only.
