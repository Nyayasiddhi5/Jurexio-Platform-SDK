# Jurexio Platform — product boundaries

**Checkout folder:** `Jurexio-Platform` (Mac) · `/workspace` (Cursor Cloud)  
**Git remote:** https://github.com/Jurexio-Inc/Jurexio-SDK.git

| Product | Directory | Purpose |
| --- | --- | --- |
| **Jurexio SDK** | `jurexio-sdk/` | API gateway (`src/`), packages, registries, infra, scripts, shared server code |
| **Jurexio Governance** | `jurexio-governance/` | Administration console (`client/` Vite app) |
| **Jurexio Enterprise** | `jurexio-enterprise/` | Future end-user application — scaffold only until product GO |

Cross-cutting: `documents/`, root `package.json`, Docker, CI, `tests/`.

**Rule:** Enterprise firm UI is built under `jurexio-enterprise/` and calls SDK APIs — no duplicate registry/access logic.
