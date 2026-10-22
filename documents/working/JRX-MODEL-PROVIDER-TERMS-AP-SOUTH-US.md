# Model provider terms — Chairman Q4 (22 Oct 2026)

**Status:** Engineering posture **approved by Chairman** — subject to **DPA execution**  
**Registry metadata:** `events.json` → `_meta.chairman` (Q4 summary)  
**Allow-list owner:** Engine platform model registry (G-03-09) — tenants may **tighten only** (CH-5)

## Approved v1 posture

| Rule | Detail |
| --- | --- |
| **AWS Bedrock in-region** | **Approved** for production client data in **ap-south-1** (IN) and **us-east-1** (US) |
| **On-demand model IDs** | Use only model IDs **hosted in** the tenant’s region |
| **Cross-region inference profiles** | **Disabled** — they can route Indian prompts outside India |
| **OpenRouter** | **Not approved** for any client data in either jurisdiction in v1.0 — **synthetic/dev only** |
| **Credential vaults** | **Two key sets** — one per region, stored in that region’s vault (M10 D1), registered per jurisdiction in Engine model registry |

## Hindi quality bar (Engine D8)

Before production Hindi routing:

- Hindi legal evaluation set scored by **two verified Hindi-competent lawyers**
- **Faithfulness ≥ 90%**, **zero invented citations**, **average reviewer rating ≥ 4/5**
- Every Hindi output remains **human-reviewed** (Engine R2 / G-03 gates)

## DPA status (25 Oct deliverable — legal)

| Provider | Region | DPA status (22 Oct) | Owner |
| --- | --- | --- | --- |
| **AWS Bedrock** | ap-south-1 | **In review** — standard AWS DPA + Bedrock service terms; zero retention/no training clauses under legal review | NYAYASIDDHI legal + CTO |
| **AWS Bedrock** | us-east-1 | **In review** — same as IN | NYAYASIDDHI legal + CTO |
| **OpenRouter** | n/a | **Not in scope** for client data v1; no DPA path for production | — |

CTO to confirm final executed DPA dates in Project-Tracker when legal closes.

## Engineering enforcement

- Provider allow-list in **Engine model registry** (not tenant CommandCentre setting).
- Gateway rejects IN-tenant calls to non-allow-listed or cross-region model IDs.
- Log model ID + region + latency only (NV-SECRETS-001).
