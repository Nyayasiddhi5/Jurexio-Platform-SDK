---
status: completed
version: 3.1.2
superseded_by: null
last_verified: 2026-04-27T13:30Z
prior_last_verified: 2026-04-25
remediation_closeout: 2026-04-27
---
# Multi-platform governance

> **2026-04-27 — Live-audit closeout (NSP-relevant).** The two NSP launch blockers affecting the `nsp` partner tenant on EC2 `13.232.165.242` are CLOSED on the running `nyv-gateway` container: **NV-NSP-FIX-002 rev2** (content-filter rewrite — only 14 strict-prescriptive phrases hard-block; `legal advice` is a soft term exempted by 6 disclaimer regex; word-boundary matching) and **NV-NSP-FIX-003** (`outbound:llm` circuit-breaker `60 s → 120 s` in `src/services/circuit-breaker.ts:69`). Live re-validation against `https://api.nyayasiddhi.online/api/nv/orchestrate` (NSP partner key flow) returned 200 OK / 2476 ms / `compliancePassed:true` for the BNS s318 / IN positive case, and `compliancePassed:false` with the violation surfaced for the negative test. Tenant isolation invariants in `nv-tenant-isolation` are unchanged. **Open follow-up affecting all 5 partners:** the rev2 fixes currently live as a `docker cp` overlay on the running container — they must be baked into the canonical Docker image before any container recreation (FU-T010) or all five partners regress to the pre-fix behaviour.

Five ecosystem partners share the same Nyayavigya gateway:

| Code | Name | Subdomain | Container | Tenant id |
|---|---|---|---|---|
| NYM | NyayaMitra | nym | nyv-nym-app | `nym` |
| NYS-PRO | NYS-PRO | pro | nyv-nsp-app | `nsp` |
| NYS-INS | NYS-INS | ins | nyv-nsi-app | `nsi` |
| NYS-ACE | NYS-ACE | ace | nyv-nsa-app | `nsa` |
| NYS-MIN | NYS-MIN | min | nyv-nsm-app | `nsm` |

## Isolation guarantees

1. **Network**: Partner containers cannot reach each other. They share an
   internal Docker network only with the gateway pool, not with each other.
2. **API key scope**: Each partner has its own SDK API key under
   `nyayavigya/<env>/<partner>/sdk_api_key`. Keys are bound to a single
   `organization_id` server-side.
3. **Tenant enforcement**: The `nv-tenant-isolation` middleware (vitest
   covered) returns 403 if any claimed tenant in the request body / query /
   headers does not match the API-key's tenant.
4. **IAM**: Each partner has a deploy IAM role
   (`nyv-prod-<partner>-deploy`) with ECR push restricted to its own repo,
   Secrets read restricted to its own prefix, and CloudWatch write restricted
   to its own log-group prefix. The role's trust policy supports either an
   IAM user or GitHub OIDC.

## Adding a new partner

1. Add the partner code to `local.partners` in `infra/terraform/envs/prod/main.tf`.
2. Add the partner repo name to `var.repos` in `infra/terraform/modules/ecr/main.tf`.
3. Add the secret keys (`<partner>/sdk_api_key`) to `var.partner_keys` in
   `modules/secrets/main.tf`.
4. Add the partner subdomain to `local.prod_subdomains` in
   `modules/route53/main.tf` (and the staging equivalent).
5. Add the Caddy `reverse_proxy` block in `infra/caddy/Caddyfile`.
6. Add the partner service block (prod + staging) in
   `docker-compose.ecosystem.yml` and `docker-compose.staging.yml`.
7. `terraform apply` (prod and staging).
8. Add the new partner's tests to `src/middleware/__tests__/nv-tenant-isolation.test.ts`.

## Partner-specific runtime config

Each partner container receives:

| Env var | Value |
|---|---|
| `NYV_TENANT_ID` | partner code |
| `NYV_SDK_BASE` | `http://nyv-gateway-a:5000` |
| `NYV_SDK_API_KEY_REF` | `secret://nyayavigya/<env>/<partner>/sdk_api_key` |
| `NYV_PLATFORM_CODE` | the canonical platform code (e.g. `NYS-PRO`) |

The container's entrypoint (`secrets-entrypoint.sh`) resolves
`NYV_SDK_API_KEY_REF` to the actual key value from Secrets Manager.

## Cross-partner data sharing

Disallowed by default. If two partners need to share data (e.g. NYM has a
case file that NYS-PRO needs to extend with court filing), the gateway
mediates: NYM's user explicitly grants a share token, that token carries an
audited proof of consent, and NYS-PRO redeems it through the gateway. The
two partner containers never talk directly.

## Brand surface

Each partner owns its own subdomain, color palette, and email-from address
(via SES once provisioned). The gateway exposes a `/v1/branding/me` endpoint
that the partner UI uses to render the right logo / palette without
hard-coding it.
