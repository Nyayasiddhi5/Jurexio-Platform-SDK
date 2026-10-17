---
status: completed
version: 3.1.2
superseded_by: null
last_verified: 2026-04-25
---
# DNS + Edge

How a request from `https://api.nyayasiddhi.online/v1/chat` ends up at the
gateway container.

## DNS chain

```
client
  │  resolves api.nyayasiddhi.online
  ▼
BigRock authoritative NS               (until cutover)
  │  delegated to →
  ▼
Route 53 hosted zone (Terraform-managed)
  │  ALIAS A record →
  ▼
ALB DNS (nyv-prod-alb-…elb.amazonaws.com)
```

### BigRock cutover (one-time, operator-only)

1. Run `cd infra/terraform/envs/prod && terraform output route53_nameservers`.
   You will see four `ns-*.awsdns-*.{com,net,org,co.uk}` entries.
2. Log in to BigRock → My Domains → `nyayasiddhi.online` → Manage Nameservers.
3. Replace ALL existing NS records with the four AWS values.
4. Save. TTL is typically 4 hours; full propagation up to 48 hours.
5. Verify with `dig +short ns nyayasiddhi.online` (should return the AWS NSs).

Until step 4 is complete, the Route53 records exist but are inert.

## Subdomain map

### Production (ALB: prod)

| Subdomain | Routes to | Purpose |
|---|---|---|
| `api.nyayasiddhi.online` | gateway pool | SDK API + JSON endpoints |
| `console.nyayasiddhi.online` | console | Admin UI |
| `docs.nyayasiddhi.online` | console (placeholder) | Public docs (will move to mintlify) |
| `status.nyayasiddhi.online` | gateway `/health` + `/metrics` | Public status page |
| `pro.nyayasiddhi.online` | nsp-app | NYS-PRO frontend |
| `nym.nyayasiddhi.online` | nym-app | NyayaMitra frontend |
| `ins.nyayasiddhi.online` | nsi-app | NYS-INS frontend |
| `ace.nyayasiddhi.online` | nsa-app | NYS-ACE frontend |
| `min.nyayasiddhi.online` | nsm-app | NYS-MIN frontend |
| `nyayasiddhi.online` (apex) | S3 redirect bucket | 301 → `https://console.…` |
| `www.nyayasiddhi.online` | S3 redirect bucket | 301 → `https://console.…` |

### Staging (ALB: staging)

| Subdomain | Routes to |
|---|---|
| `staging.nyayasiddhi.online` | gateway-staging |
| `staging-pro.nyayasiddhi.online` | nsp-staging |
| `staging-nym.nyayasiddhi.online` | nym-staging |
| `staging-ins.nyayasiddhi.online` | nsi-staging |
| `staging-ace.nyayasiddhi.online` | nsa-staging |
| `staging-min.nyayasiddhi.online` | nsm-staging |

## TLS

ACM issues a single certificate with:
- `nyayasiddhi.online`
- `*.nyayasiddhi.online` (covers all production + all staging subs)
- `www.nyayasiddhi.online`

Validation method: DNS (Terraform creates the validation CNAMEs in the same
hosted zone, so this is fully automated).

The ALB listener uses `ELBSecurityPolicy-TLS13-1-2-2021-06`. After cutover,
verify with [SSL Labs](https://www.ssllabs.com/ssltest/) — target grade A+.

## ALB → host

| Hop | Detail |
|---|---|
| ALB listener `:443` | Forwards everything to TG `nyv-prod-alb-edge` |
| TG | Single target: the EC2 instance, port 80 |
| Caddy `:80` | Reads `Host` header, dispatches to the right container |
| Container | Returns response |

The host's security group only allows port 80 from the ALB security group —
the EC2 host is not directly reachable from the internet.

## WAF

Attached to the ALB. Three rules in count mode by default:

1. `AWS-AWSManagedRulesCommonRuleSet`
2. `AWS-AWSManagedRulesKnownBadInputsRuleSet`
3. `PerIpRateLimit` — 2000 reqs / 5 min per IP

Flip to block once you've observed at least one week of false-positive-free
matches in the CloudWatch metrics.

## Caching

There is no CDN in front of the ALB today. Once `docs.nyayasiddhi.online`
moves to a static doc generator we will put a CloudFront in front of it; the
gateway path stays direct (no edge cache).
