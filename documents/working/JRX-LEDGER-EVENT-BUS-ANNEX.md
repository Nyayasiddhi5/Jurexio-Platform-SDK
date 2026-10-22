# Platform event bus annex — Ledger Core (M09 CB-ENG-02)

**Status:** RFC v1 — 25 Oct 2026  
**Owner:** CTO / M09 Ledger  
**Depends on:** Event registry v1 adopted (`jurexio-specs/registry/events.json`)

## Purpose

All modules emit **canonical events** to the **Jurexio Ledger** event bus. The bus is the system of record for audit, replay, and cross-module subscriptions (DeadlineGuard, CommandCentre, DataMigrate).

## Topology

```text
Module service → validate(event name in registry) → Ledger ingest API
                → append-only chain (tenant-scoped)
                → fan-out (async): notifications, RegRadar, analytics
```

## Contract

1. **Canonical names only** after alias sunset (`events._meta.alias_policy`).
2. **Critical events** (`critical: true`) require synchronous ack from Ledger before module commits local state (when wired in Sprint 1+).
3. **Gate outcomes** use `DOMAIN.G_NN_NN_REJECTED` / `_WITHDRAWN` with mandatory `rejection_reason` in payload schema (Ledger envelope).
4. **FLAG-012** migration lifecycle: eighteen events in `events._meta.flag_012_core_events`; **critical subset** in `critical_events_v1.json` → `flag_012_critical` (Chairman Q1).
5. **C-08:** One human act → one canonical event **per record changed**, single transaction; multiple records ⇒ multiple events (e.g. G-09-07 chain + incident).

## Ingest rules

| Check | On failure |
| --- | --- |
| Name in registry | `LEDGER.REGISTRY_EVENT_REJECTED` |
| Legacy alias after sunset | Reject with pointer to `maps_to` |
| Unknown tenant / wall violation | Deny at CommandCentre before emit |

## SDK / gateway (current)

- Enterprise gateway already publishes activity and orchestration events; Sprint 1 wires **registry-driven validation** at the Ledger ingest boundary.
- BullMQ queues `jrx-platform-relay` remain transport; Ledger is authoritative store.

## Open items (Chairman)

- C-08 cross-module duplicate events (see questions doc).
- Regional Postgres replication for Ledger (separate infra RFC).
