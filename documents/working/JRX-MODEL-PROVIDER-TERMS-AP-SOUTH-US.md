# Model provider terms — India (ap-south-1) and US (us-east-1)

**Status:** CTO memo v1 for Chairman sign-off (25 Oct 2026)  
**Blocks:** India AI launch (M03 Engine), Hindi-capable inference

## Posture (v1)

| Region | Primary inference | Data residency | Retention / training |
| --- | --- | --- | --- |
| **ap-south-1** | AWS Bedrock models deployed in **ap-south-1** | IN tenant prompts and outputs processed **in-region** | Contractual **zero retention** for customer content; **no model training** on customer data |
| **us-east-1** | AWS Bedrock in **us-east-1** for US tenants | US tenant data **in-region** | Same zero-retention / no-training terms |

## Hindi capability

- At least **one Hindi-capable model** must be available in **ap-south-1** for production tenant routing (Engine HR tiers and client-facing summaries where configured).
- Minimum quality bar: **human-review gate (G-03-*)** remains mandatory for released outputs; Hindi models are not auto-release without review permissions.

## Fallback and cross-border

- **IN tenant data must not** be routed to us-east-1 or third-party aggregators (e.g. OpenRouter) without explicit Chairman-approved DPA and tenant opt-in.
- US tenants may use us-east-1 only; no silent cross-region failover for IN.

## Commercial / legal

- DPA and Bedrock service terms to be executed by NYAYASIDDHI / Jurexio legal before production India AI launch.
- Chairman to confirm acceptable provider list (Q4 in conflict register).

## Engineering hooks

- `JRX_BEDROCK_REGION` / tenant region binding in gateway LLM catalog (existing SDK paths).
- Audit: log model ID, region, and latency only — no prompt content in logs (NV-SECRETS-001).
