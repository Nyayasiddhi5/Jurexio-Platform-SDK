# R5 — EC2 Redis Bastion Cutover (Replit dev → ElastiCache)

**Date**: 2026-05-07
**Status**: Bastion LIVE + tested end-to-end from Replit
**Acceptance**: 0 Upstash AUTH errors after Replit secret update + workflow restart

## What was built

A `stunnel4` TLS bastion on EC2 `i-0df71e5ea1df8f588` that terminates TLS toward
ElastiCache (`master.nyv-dev-edge-redis.4iynom.aps1.cache.amazonaws.com:6379`)
and exposes a plain-TCP Redis listener on the EC2 public interface. Replit
gateway connects via plain `redis://` over the public internet, AUTH-protected
by the existing 32-char ElastiCache password. End-to-end TLS to ElastiCache is
preserved (stunnel client mode, SNI = ElastiCache hostname, `verifyChain=no`
because ElastiCache uses a private CA).

### Components

| Item | Value |
|---|---|
| Bastion host | `13.232.165.242` (ec2-13-232-165-242.ap-south-1.compute.amazonaws.com) |
| Bastion port | `16379` (TCP, plain — TLS upstream via stunnel) |
| Upstream | `master.nyv-dev-edge-redis.4iynom.aps1.cache.amazonaws.com:6379` (TLS) |
| stunnel config | `/etc/stunnel/redis-bastion.conf` |
| systemd unit | `redis-bastion.service` (enabled, active) |
| Security Group | `sg-0ba15ba2b74a651fb` rule `sgr-09655d9c2b4dfc587` (tcp/16379 from 0.0.0.0/0) |
| Auth | Existing ElastiCache 32-char password (unchanged) |

### Validation (from Replit shell)

```text
PING: PONG | version: 7.1.0
SET/GET roundtrip OK: 1778138454097
BASTION_FULL_OK
```

## Replit secret update required

Replit secrets must be updated to point off Upstash to the bastion:

```text
NYV_REDIS_TCP_URL  = redis://default:<ELASTICACHE_PASSWORD>@13.232.165.242:16379
NYV_REDIS_WRITE_URL = redis://default:<ELASTICACHE_PASSWORD>@13.232.165.242:16379
```

(Use the same 32-char password already in `/opt/nyayavigya/secrets/.env.production`
on EC2; identical to the EC2 gateway's working password.)

After secret update + `restart_workflow NYV Gateway`, the Upstash AUTH-quota
errors must stop.

## Rollback (if needed)

```bash
ssh ubuntu@13.232.165.242 sudo systemctl stop redis-bastion
aws ec2 revoke-security-group-ingress --group-id sg-0ba15ba2b74a651fb \
    --protocol tcp --port 16379 --cidr 0.0.0.0/0 --region ap-south-1
# Then revert Replit secrets to the prior Upstash URL.
```

## Hardening follow-ups (post-cutover)

1. Restrict SG to AWS Replit egress prefix-list (when published).
2. Switch stunnel listener to OPENSSL with bastion cert + client-cert auth.
3. Add CloudWatch alarm on `redis-bastion.service` failures.
4. Rotate the ElastiCache AUTH password (32-char) — currently shared between
   EC2 internal and Replit-via-bastion paths.
