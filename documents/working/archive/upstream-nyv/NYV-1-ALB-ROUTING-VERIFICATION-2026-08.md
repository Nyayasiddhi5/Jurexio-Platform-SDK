# NYV-1 — NSP ALB routing claim: verification, verdict, and the one real fix

- **Date:** 2026-08-20
- **Classification:** NYV (infrastructure — AWS ALB + nginx ingress)
- **Host:** `i-0df71e5ea1df8f588` (nysdev / nyv-dev-sdk), region `ap-south-1`
- **ALB:** `nyv-dev-edge-alb` (`arn:...:loadbalancer/app/nyv-dev-edge-alb/de64ede3dc9d8bbb`)
- **Repo state at verification:** HEAD `232a92e`
- **Method:** every fact below is the output of a command that was executed. Hypotheses are labelled as such (NV-EXECUTE-BEFORE-CLAIM-001).

---

## 1. Executive verdict

NSP made three asks. Two are wrong, one is right.

| # | NSP ask | Verdict |
|---|---|---|
| 1 | Re-target `nyv-dev-edge-tg` from port 80 → 5000 | **HARMFUL — do not do.** Port 80 is the intended design. Re-targeting removes nginx from the public path and measurably breaks console route canonicalisation and static-asset caching. |
| 2 | Have `nyv-console` proxy `/api/nv/*` to the gateway | **ALREADY SATISFIED.** `location /api/ { proxy_pass http://gateway:5000; }` has been live all along. |
| 3 | Add a host rule for `api.nyayasiddhi.online` | **CORRECT and worth doing.** Proven by execution: `api.*` matches no rule and is served only by the default rule. **Implemented** — see §6. |

**NSP's diagnosis was wrong.** They observed real symptoms — `:80` bound to `nyv-console`, the target unhealthy, `502 from nginx/1.27.5` — but all of those were artefacts of the **2026-08-19 docker network partition** (`NV-DEPLOY-NET-PROJECT-001`), not of ALB configuration. The port-80 target group is the architecture working as designed. See §5 for the disproof.

---

## 2. ALB topology — actual, as read from the API

Two listeners on `nyv-dev-edge-alb`:

| Listener | Protocol:Port | Default action |
|---|---|---|
| `...listener/.../8e5f1c2bd7a0bb9a` | HTTPS:443 (ACM `4fec415f-…`, `ELBSecurityPolicy-TLS13-1-2-2021-06`) | forward → `nyv-dev-edge-tg` |
| `...listener/.../a376406efefb05f7` | HTTP:80 | redirect → HTTPS:443, `HTTP_301` |

The HTTP:80 listener has **only** its default rule (the 301 redirect). All host routing lives on HTTPS:443.

### HTTPS:443 rules — exact prior state (recorded before any change)

| Priority | Host-header condition | Forwards to |
|---|---|---|
| 100 | `pro.nyayasiddhi.online` | `nsp-edge-tg` |
| 110 | `app-pro.nyayasiddhi.online` | `nsp-edge-tg` |
| 120 | `api-pro.nyayasiddhi.online` | `nsp-edge-tg` |
| 130 | `admin-pro.nyayasiddhi.online` | `nsp-edge-tg` |
| 140 | `dev-pro.nyayasiddhi.online` | `nsp-edge-tg` |
| 150 | `nym.nyayasiddhi.online` | `nym-edge-tg` |
| 160 | `nyayasearch.nyayasiddhi.online` | `nyv-search-tg` |
| **default** | *(none)* | **`nyv-dev-edge-tg`** |

All conditions are **exact** host values — there are no wildcard host conditions.

**`api.nyayasiddhi.online` and `console.nyayasiddhi.online` appear nowhere.** Both were served solely by the default rule. NSP's third observation is factually correct.

Note `api-pro.nyayasiddhi.online` (priority 120) is a *different* host from `api.nyayasiddhi.online` and points at a *different instance* (`nsp-edge-tg` → `i-064217c6128086123`).

### Target groups

| Name | Port | Proto | HC path | HC port | Matcher | Target health at 2026-08-20T05:08Z |
|---|---|---|---|---|---|---|
| `nyv-dev-edge-tg` | **80** | HTTP | `/health` | traffic-port (80) | `200,404` | `i-0df71e5ea1df8f588:80` → **healthy** |
| `nsp-edge-tg` | 80 | HTTP | `/health` | traffic-port | `200` | `i-064217c6128086123:80` → healthy |
| `nym-edge-tg` | 3000 | HTTP | `/health` | traffic-port | `200` | — |
| `nyv-search-tg` | 8080 | HTTP | `/api/healthz` | traffic-port | `200` | — |

`nyv-dev-edge-tg` is **healthy right now**, not unhealthy as NSP reported.

### DNS

`api`, `console`, `pro`, `nyayasearch` `.nyayasiddhi.online` and the ALB's own DNS name all resolve to the **same three A records** — `13.204.32.86`, `13.205.10.156`, `43.205.193.32`. Confirmed: `api.*` and `console.*` are the same ALB.

---

## 3. What is actually bound on the instance

```
nyv-console   Up 2 hours (healthy)   0.0.0.0:80->80/tcp
nyv-gateway   Up 2 hours (healthy)   0.0.0.0:5000->5000/tcp
nyv-postgres  Up 3 months (healthy)  5432/tcp
nyv-redis     Up 3 months (healthy)  6379/tcp
```

`ss -ltnp`: `:80` and `:5000` are both `docker-proxy`. NSP's port-binding observation is **correct** — `:80` is the console, `:5000` is the gateway. Their *inference* from it is what fails.

Network topology (the 2026-08-19 failure mode, now healed):

```
nyv-gateway nets: nyayavigya-platform-312_nyv-net=172.18.0.4
nyv-console nets: nyayavigya-platform-312_nyv-net=172.18.0.5
console resolves 'gateway': 172.18.0.4  gateway  gateway
console healthcheck: status=healthy failingStreak=0
```

Both containers are on the **same** network, and `gateway` resolves from inside the console. During the outage the gateway was stranded on `…-aws-ssm-7c5b1ff2_nyv-net` at `172.21.0.2` and this lookup was NXDOMAIN.

---

## 4. Ask #2 is already satisfied — the config line

`/etc/nginx/conf.d/nyayavigya.conf` inside `nyv-console`, lines 18–29:

```nginx
location /api/ {
    proxy_pass http://gateway:5000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
}
```

`location /api/` covers `/api/nv/*`. There is nothing to build. `nginx -t` → syntax ok.

The architecture is therefore, by design:

```
client → ALB:443 → nyv-dev-edge-tg (:80) → nginx in nyv-console → proxy_pass http://gateway:5000 → nyv-gateway
```

An ALB target group on port 80 is **correct**, provided nginx can reach the gateway. On 2026-08-19 it could not, and that — not the port — is what produced the 502s.

---

## 5. Why NSP's diagnosis is wrong — four independent disproofs

**(a) The 502 came from nginx, and nginx is only reachable *through* the port-80 target group.**
`https://api.nyayasiddhi.online/health` returns `200` with `server: nginx/1.27.5`. If `api.*` were not reaching nginx, no nginx header could appear. If the ALB itself had failed to route, the error page would carry `server: awselb/2.0`, not `nginx/1.27.5`. NSP's own evidence — "502 **from nginx/1.27.5**" — proves the ALB delivered the request to nginx correctly. The failure was one hop *past* the ALB.

**(b) The ALB configuration has not changed in five days.** CloudTrail, `2026-08-15T00:00Z → 2026-08-20T06:00Z`, region `ap-south-1`:

```
ModifyTargetGroup = 0        ModifyRule = 0        ModifyListener = 0
DeleteRule = 0               SetRulePriorities = 0 ModifyTargetGroupAttributes = 0
RegisterTargets = 0          DeregisterTargets = 0
CreateRule = 0  ← at first query (05:13Z); now 2, and both are MY OWN rules from §7
```

**Positive control — NV-VALIDATE-THE-PROBE-001.** A probe that returns nothing but zeros is indistinguishable from a probe that is simply broken, so these zeros are not trusted on their own. The control is my own change: the two rules added in §7 were created *after* the first query ran, so re-querying must find them. It does —

```
CreateRule in 2026-08-20T05:00Z–06:00Z = 2
  2026-08-20T05:16:09Z  CreateRule  developer
  2026-08-20T05:15:43Z  CreateRule  developer
```

— proving `lookup-events` genuinely reports ELBv2 mutations in this region and window. The eight remaining zeros are therefore real absences, not query failures.

This also yields a stronger statement than intended: across the whole five-day period the **only** ALB mutation of any kind is the two rules added by this task. The configuration was byte-identical before, during, and after the outage. A constant cannot explain a transient.

*(Recorded honestly: the first run of this query exited 254 on a trailing unfiltered `lookup-events` used only to pretty-print non-zero hits — it pages over all events for 5 days and timed out. The nine per-event counts above it had already returned. The failure was in a cosmetic sub-query, not in the counts, and the control above is what makes the counts believable.)*

**(c) The same port-80 target group was healthy either side of the outage.** `UnHealthyHostCount` for `nyv-dev-edge-tg`, `2026-08-17T00:00Z → 2026-08-20T06:00Z`, hourly — non-zero in exactly **2 of 78** buckets, both on 2026-08-19. `HealthyHostCount > 0` in **76 of 78** buckets. At 5-minute resolution the unhealthy run is:

```
15:55Z, 16:00Z, 16:05Z, 16:10Z, 16:15Z, 16:20Z,
16:25Z, 16:30Z, 16:35Z, 16:40Z, 16:45Z   (Max=1 each)
```

That is `15:55Z–16:45Z` — matching the independently-recorded outage window `15:55:18Z–16:46:46Z` to within one sampling interval, and zero outside it.

**(d) The gateway was reachable the whole time on `:5000`, which is exactly why the outage was misread.** `:5000` bypasses nginx. NSP's on-host probe of `localhost:5000/...` returning `200 in 0.67s, 4 results` is the *same trap* that made the outage last 51 minutes: it skips the broken hop. `scripts/nv-verify-ingress.sh` exists specifically to make that mistake impossible, and treats gateway-200 + ingress-5xx as a hard fail.

**Conclusion:** NSP correctly observed the symptoms of a docker network partition and misattributed them to ALB configuration. Their `:80`/console/unhealthy observations are all consistent with the outage window and with a *working* by-design topology.

---

## 6. Ask #1 — re-targeting to :5000 would be a regression (measured, not asserted)

Measured `:80` (today's path, through nginx) against `:5000` (NSP's proposal, gateway direct):

| Path | `:80` (nginx) | `:5000` (gateway) | Impact of re-targeting |
|---|---|---|---|
| `/` | 200 html 2143 | 200 html 2143 | none |
| `/health` | 200 json 1386 | 200 json 1386 | none |
| `/api/nv/health` | 200 json | 200 json | none |
| `/login` | **302 → `/console/login`** | 200 (SPA) | **canonical redirect lost** |
| `/dashboard` | **302 → `/console/dashboard`** | 200 (SPA) | **canonical redirect lost** |
| `/billing` | **302 → `/console/billing`** | 200 (SPA) | **canonical redirect lost** |
| `/admin` | **302 → `/console/admin`** | 200 (SPA) | **canonical redirect lost** |
| `/command-centre` | **302 → `/console/command-centre`** | 200 (SPA) | **canonical redirect lost** |
| `/assets/index-*.js` | 200, `Cache-Control: max-age=31536000, public, immutable`, `Expires: +1y` | 200, `Cache-Control: public, max-age=0` | **immutable asset caching lost** |

Two concrete regressions, both measured:

1. **Console route canonicalisation.** nginx `location ~ ^/(dashboard|sdk-hub|…|login|home)(/|$|\?)` returns `302 /console$request_uri` for 31 route prefixes. The gateway does not do this — it serves the SPA at 200. Re-targeting silently changes the canonical URL contract for every console route.
2. **Static-asset cache policy.** nginx serves hashed assets with `max-age=31536000, immutable`; the gateway serves them `max-age=0`. Re-targeting would send every console asset back to the origin on every navigation.

**Falsified hypothesis, recorded for honesty:** I expected re-targeting to also expose the `/metrics` endpoint, since nginx guards it with an RFC1918 `allow` / `deny all` block (conf lines 50–58). Measured instead: `/metrics` returns `2141` bytes of `<!DOCTYPE html>` on **both** `:80` and `:5000` — an SPA fallback, not a Prometheus exposition (no `# HELP` / `# TYPE` lines). There is **no** metrics-exposure regression. The nginx allowlist is currently guarding nothing. Reported as measured, not as feared.

**Verdict: re-targeting `nyv-dev-edge-tg` to port 5000 is harmful and unnecessary.** Not implemented. Per instruction, a TG port change was never in scope without explicit approval — and the evidence says it should not be approved.

---

## 7. Ask #3 — the one legitimate fix, and it is implemented

### Proof that `api.*` depended on the default rule

Host-header probes sent directly at the ALB IP (`43.205.193.32`) with SNI pinned via `--resolve`, all to `/health`:

| Host claimed | Result | Backend reached |
|---|---|---|
| `pro.nyayasiddhi.online` (rule @100) | `200`, 140 bytes, no `server` hdr | `nsp-edge-tg` — `{"service":"nyayasiddhi-professional-api"}` |
| `nyayasearch.nyayasiddhi.online` (rule @160) | `200`, 1443 bytes | `nyv-search-tg` |
| `api.nyayasiddhi.online` (**no rule**) | `200`, **1386** bytes, `server: nginx/1.27.5` | default → `nyv-dev-edge-tg` |
| `console.nyayasiddhi.online` (**no rule**) | `200`, 1383 bytes, `server: nginx/1.27.5` | default → `nyv-dev-edge-tg` |
| `this-host-has-no-rule.nyayasiddhi.online` (**definitely no rule**) | `200`, **1386** bytes, `server: nginx/1.27.5` | default → `nyv-dev-edge-tg` |

`api.nyayasiddhi.online` is **byte-for-byte indistinguishable from a hostname that does not exist.** That is the definition of default-rule dependency, and it is the risk worth removing: partner traffic was surviving on a fallback, so any future change to the default action would silently redirect NSP's production integration.

### Change applied

Purely **additive** — two new host rules forwarding to `nyv-dev-edge-tg`, the *same* target group the default already selected. Behaviour today is identical; the routing is now explicit and pinned. Priorities `170`/`180` sit *below* every existing rule, so no existing host's precedence changes, and no existing rule or the default rule was modified.

```bash
aws elbv2 create-rule --region ap-south-1 \
  --listener-arn arn:aws:elasticloadbalancing:ap-south-1:789925699169:listener/app/nyv-dev-edge-alb/de64ede3dc9d8bbb/8e5f1c2bd7a0bb9a \
  --priority 170 \
  --conditions 'Field=host-header,HostHeaderConfig={Values=[api.nyayasiddhi.online]}' \
  --actions 'Type=forward,TargetGroupArn=arn:aws:elasticloadbalancing:ap-south-1:789925699169:targetgroup/nyv-dev-edge-tg/2886b2cede5cf539' \
  --tags Key=nv-change,Value=NYV-1-2026-08-20 Key=nv-reason,Value=pin-partner-host-off-default-rule
# …and the same at --priority 180 for console.nyayasiddhi.online
```

New rule ARNs:

| Priority | Host | Rule ARN suffix |
|---|---|---|
| 170 | `api.nyayasiddhi.online` | `…/8e5f1c2bd7a0bb9a/4d6afc8575f210bd` |
| 180 | `console.nyayasiddhi.online` | `…/8e5f1c2bd7a0bb9a/f42cecd98c720b38` |

### After state — full HTTPS:443 rule table

| Priority | Host-header | Forwards to | Changed? |
|---|---|---|---|
| 100 | `pro.nyayasiddhi.online` | `nsp-edge-tg` | untouched |
| 110 | `app-pro.nyayasiddhi.online` | `nsp-edge-tg` | untouched |
| 120 | `api-pro.nyayasiddhi.online` | `nsp-edge-tg` | untouched |
| 130 | `admin-pro.nyayasiddhi.online` | `nsp-edge-tg` | untouched |
| 140 | `dev-pro.nyayasiddhi.online` | `nsp-edge-tg` | untouched |
| 150 | `nym.nyayasiddhi.online` | `nym-edge-tg` | untouched |
| 160 | `nyayasearch.nyayasiddhi.online` | `nyv-search-tg` | untouched |
| **170** | **`api.nyayasiddhi.online`** | **`nyv-dev-edge-tg`** | **ADDED** |
| **180** | **`console.nyayasiddhi.online`** | **`nyv-dev-edge-tg`** | **ADDED** |
| default | *(none)* | `nyv-dev-edge-tg` | **untouched** |

`nyv-dev-edge-tg` after the change: port **80**, HC `/health`, matcher `200,404`, target `i-0df71e5ea1df8f588:80` → **healthy**. The target group port was **not** touched.

### Post-change verification

**(a) ALB access log — direct proof the new rules are matched.** Access logging is enabled (`s3://nyv-dev-edge-alb-access-logs-789925699169/nyv-dev-edge`), and the log's `matched_rule_priority` field records which rule the ALB actually selected. `matched_rule_priority=0` means *the default rule was used*. Same 5-minute log window, before and after the change:

| `domain_name` | `matched_rule_priority` | target group | requests |
|---|---|---|---|
| `api.nyayasiddhi.online` | **0** ← default rule (**before**) | `nyv-dev-edge-tg` | 5 |
| `api.nyayasiddhi.online` | **170** ← new rule (**after**) | `nyv-dev-edge-tg` | 4 |
| `console.nyayasiddhi.online` | **0** ← default rule (**before**) | `nyv-dev-edge-tg` | 4 |
| `console.nyayasiddhi.online` | **180** ← new rule (**after**) | `nyv-dev-edge-tg` | 1 |
| `this-host-has-no-rule.nyayasiddhi.online` | **0** ← default rule | `nyv-dev-edge-tg` | 2 |
| `pro.nyayasiddhi.online` | 100 | `nsp-edge-tg` | 28 |
| `nyayasearch.nyayasiddhi.online` | 160 | `nyv-search-tg` | 22 |

This is the whole argument in one table, from the ALB's own records. `api.*` was matching priority `0` — the default — exactly like a hostname that does not exist. It now matches `170`. NSP's third observation was correct, and it is now fixed.

Marker requests (`?probe=nyv1-051700`), all `elb_status=200 target_status=200`:

| host | rule prio | target | target group |
|---|---|---|---|
| `api.nyayasiddhi.online` | 170 | `172.31.3.48:80` | `nyv-dev-edge-tg` |
| `console.nyayasiddhi.online` | 180 | `172.31.3.48:80` | `nyv-dev-edge-tg` |
| `pro.nyayasiddhi.online` | 100 | `172.31.44.6:80` | `nsp-edge-tg` |

Note the target port is **80** in every NYV row — the by-design nginx path, serving 200s.

**(b) Public probes after the change** — nothing regressed, including the hosts I did not touch:

| Probe | Status | Latency |
|---|---|---|
| `https://api.nyayasiddhi.online/health` | 200 | 0.120 s |
| `https://api.nyayasiddhi.online/api/nv/health` | 200 | 0.073 s |
| `https://console.nyayasiddhi.online/health` | 200 | 0.134 s |
| `https://console.nyayasiddhi.online/` (SPA) | 200 | 0.067 s |
| `https://pro.nyayasiddhi.online/health` (untouched) | 200 | 0.116 s |
| `https://nyayasearch.nyayasiddhi.online/` (untouched) | 200 | 0.124 s |

`api.nyayasiddhi.online/health` still returns `server: nginx/1.27.5` — confirming traffic still goes through the console's nginx, i.e. the intended path is intact.

**(c) `scripts/nv-verify-ingress.sh` on the host, after the change:**

```
[ingress] shared network(s): nyayavigya-platform-312_nyv-net — OK
[ingress] console resolves 'gateway': 172.18.0.4        gateway  gateway
[ingress] gateway  http://127.0.0.1:5000/api/nv/health -> HTTP 200
[ingress] ingress  http://127.0.0.1/api/nv/health -> HTTP 200 after 0s
[ingress] console healthcheck: status=healthy failingStreak=0
[ingress] public   https://api.nyayasiddhi.online/api/nv/health -> HTTP 200
[ingress] VERDICT: PASS (gateway=200 ingress=200 warnings=0)
```

Exit 0, zero warnings.

**(d) Real partner-shaped call through the public hostname**, headers `x-api-key` (`NYV_SDK_KEY_NSP`, `key_len=64`, value never printed), `x-nyv-platform: nsp`, `x-nyv-consent: granted`:

| Route | Status | Latency | Payload |
|---|---|---|---|
| `https://api.nyayasiddhi.online/api/nv/knowledge/statutes/search?q=BNS 103` | **200** | 1.658 s | 7417 B, `total: 4` results, `source: nys-knowledge-plane` |
| `http://localhost/api/nv/…` (through nginx `:80`) | 200 | 0.337 s | 7417 B, 4 results |
| `http://localhost:5000/api/nv/…` (gateway direct) | 200 | 0.374 s | 7417 B, 4 results |

All three hops agree — 4 results, identical payload size. The partner path is working end-to-end through the public hostname.

---

## 8. Reversal procedure

The change is reversible by deletion alone — no rule was modified, so nothing needs restoring:

```bash
source scripts/nv-source-dev-deploy-env.sh
aws elbv2 delete-rule --region ap-south-1 --rule-arn \
  arn:aws:elasticloadbalancing:ap-south-1:789925699169:listener-rule/app/nyv-dev-edge-alb/de64ede3dc9d8bbb/8e5f1c2bd7a0bb9a/4d6afc8575f210bd   # api  @170
aws elbv2 delete-rule --region ap-south-1 --rule-arn \
  arn:aws:elasticloadbalancing:ap-south-1:789925699169:listener-rule/app/nyv-dev-edge-alb/de64ede3dc9d8bbb/8e5f1c2bd7a0bb9a/f42cecd98c720b38   # console @180
```

Deleting them returns `api.*` / `console.*` to default-rule service — i.e. exactly the prior state documented in §2. Because both rules forward to the *same* target group the default already selects, deletion is behaviourally invisible; only `matched_rule_priority` in the access log would revert to `0`.

---

## 9. Reproducing this audit

```bash
cd nyayavigya-platform-312
# ALB topology + target health (read-only)
bash -c 'source scripts/nv-source-dev-deploy-env.sh && aws elbv2 describe-rules --region ap-south-1 \
  --listener-arn arn:aws:elasticloadbalancing:ap-south-1:789925699169:listener/app/nyv-dev-edge-alb/de64ede3dc9d8bbb/8e5f1c2bd7a0bb9a'

# on-host truth: bindings, nginx config, topology, local + partner probes (read-only)
bash scripts/nv-ec2-ssm-run.sh scripts/_ec2-alb-ingress-truth.sh      "nyv1-alb-ingress-truth"
# :80 vs :5000 regression surface for ask #1 (read-only)
bash scripts/nv-ec2-ssm-run.sh scripts/_ec2-tg5000-impact-probe.sh    "nyv1-tg5000-impact"
# falsify /metrics exposure + prove default-rule dependency (read-only)
bash scripts/nv-ec2-ssm-run.sh scripts/_ec2-default-rule-falsify.sh   "nyv1-default-rule-falsify"

# the ingress gate that would have caught the 2026-08-19 outage in seconds
bash scripts/nv-ec2-ssm-run.sh scripts/nv-verify-ingress.sh           "nyv1-verify-ingress"
```

## 10. Related

- `NV-DEPLOY-NET-PROJECT-001` — the 2026-08-19 docker network partition (the actual root cause NSP misattributed).
- `scripts/nv-verify-ingress.sh` — `NV-DEPLOY-INGRESS-VERIFY-001`; asserts the console→gateway hop, and hard-fails on gateway-200 + ingress-5xx.
- Remedy for a recurrence, **without** a restart or any `docker compose`:
  ```bash
  docker network connect --alias gateway --alias nyv-gateway \
    nyayavigya-platform-312_nyv-net nyv-gateway
  docker exec nyv-console sh -c 'nginx -t && nginx -s reload'
  ```
