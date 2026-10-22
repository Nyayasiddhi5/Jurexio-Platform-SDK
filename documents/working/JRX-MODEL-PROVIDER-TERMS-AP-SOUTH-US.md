# Model provider terms — Chairman Q4 (22 Oct 2026)

**Status:** Engineering posture **approved by Chairman** — **CTO engineering sign-off 2026-10-22 (IST)** — subject to **legal DPA execution**  
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

| Provider | Region | Engineering (CTO) | Legal / commercial |
| --- | --- | --- | --- |
| **AWS Bedrock** | ap-south-1 | **Signed off 2026-10-22** — in-region only, zero-retention posture per Chairman Q4 | **Execution pending** — standard AWS DPA + Bedrock terms under legal review |
| **AWS Bedrock** | us-east-1 | **Signed off 2026-10-22** — same as IN | **Execution pending** |
| **OpenRouter** | n/a | **Signed off 2026-10-22** — not approved for client data v1 | **Not in scope** for production DPA |

Legal to record executed DPA dates in Project-Tracker when AWS closes; engineering enforcement does not wait on legal for **dev/synthetic** environments.

## Engineering enforcement

- Provider allow-list in **Engine model registry** (not tenant CommandCentre setting).
- Gateway rejects IN-tenant calls to non-allow-listed or cross-region model IDs.
- Log model ID + region + latency only (NV-SECRETS-001).
