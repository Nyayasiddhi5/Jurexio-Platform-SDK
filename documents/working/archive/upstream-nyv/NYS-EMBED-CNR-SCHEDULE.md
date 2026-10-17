# NYS embed schedule — NSP CNR peak protection

> **Host:** caselaw-worker `i-000115b19219bb766`  
> **Installed:** 2026-09-02T18:30Z (SSM `1b4962ba-d8eb-4a47-b8f6-2242fc0c94b9`)

## Purpose

Concurrent caselaw embed + FTS load causes RDS `statement_timeout` on CNR index lookups during NSP business hours. This cron throttles embed during peak CNR traffic and restores full backfill off-peak.

## Cron (`/etc/cron.d/nys-embed-cnr-schedule`)

| Schedule (IST) | Action | Script |
|---|---|---|
| **10:00 daily** | Peak throttle — HC shards 0+1 only, `EMBED_CONCURRENCY=2`, DC/shard2/statutes stopped | `/opt/nyv/api/scripts/_phase-b-embed-resume-peak-cnr.sh` |
| **20:00 daily** | Off-peak full embed resume (all 5 units, `EMBED_CONCURRENCY=6`, `EMBED_BATCH=100`) | `/opt/nyv/api/scripts/_phase-b-embed-resume.sh` |

Timezone: `CRON_TZ=Asia/Kolkata`  
Log: `/var/log/nys-embed-cnr-schedule.log`

## Remote script copies

Installed under `/opt/nyv/api/scripts/`:

- `_phase-b-embed-resume-peak-cnr.sh` — peak CNR throttle (new)
- `_phase-b-embed-resume-throttled.sh` — legacy B6 throttle (concurrency 4)
- `_phase-b-embed-resume.sh` — full resume
- `_phase-b-embed-pause.sh` — emergency pause

## Install / reinstall (workstation)

```bash
cd nyayavigya-platform-312
npm run protect:secrets:ec2   # NV-SECRETS-PROTECT-001 before any docker ops on nysdev
bash scripts/_nys-embed-cnr-cron-install.sh
```

## Manual overrides

```bash
bash scripts/_nys-ssm-run.sh scripts/_phase-b-embed-pause.sh "manual-pause"
bash scripts/_nys-ssm-run.sh scripts/_phase-b-embed-resume-peak-cnr.sh "manual-peak"
bash scripts/_nys-ssm-run.sh scripts/_phase-b-embed-resume.sh "manual-full"
```

## Related

- `documents/working/CNR-NYS-ATHENA-OPTIMIZATION-2026-09-02.md`
- `nyayavigya-platform-312/scripts/_nys-embed-cnr-cron-install.sh`


## 2026-09-03 embed accelerate phase 2 (GO — full speed 24h)

**Throughput regression root causes (measured SSM `9b089bb6`, `259688ae`):**

1. **Stall-detector restart loop on shard 2** — monitored stale `hc:s2of3` while shard 2 writes `hc:s2of3:y2025`; restarted every ~11 min, zero sustained batches. Fixed: monitor `hc:s2of3:y2025` only + **30 min restart cooldown** after unit start.
2. **Peak CNR throttle 10h/day** — only 2 HC shards @ conc 2 during 10:00–20:00 IST. **Peak cron suspended 24h** (2026-09-03 GO) for backfill sprint.
3. **Off-peak downgrade bug** — `offpeak.conf` lowered conc 8→6 and batch 200→100. Reverted: **conc=10, batch=200**, `EMBED_HC_MAX_ROWS=200000`, `EMBED_DC_MAX_ROWS=120000`.
4. **Coverage API http=0** — not service down (`healthz=200`). Causes: (a) `AUTH_REQUIRED=1` without key → 401; (b) daily monitor `--max-time 20` vs ~240s cold COUNT. Fixed: localhost exemption for `/api/caselaw/embedding/coverage`, monitor timeout **600s**.

**Live after deploy (2026-09-03T03:10Z):** coverage **76.84%** (20,110,446 / 26,172,689), `embed-coverage-latest.json` http=200, 5/5 units active, 4× `embed-corpus.mjs` @ batch **200**.

**Cron (peak suspended):** only 20:00 IST off-peak line active; peak line commented with re-enable instructions.

**Tomorrow check:**
```bash
tail -20 /var/log/nys-embed-cnr-schedule.log
cd nyayavigya-platform-312 && bash scripts/_nys-ssm-run.sh scripts/_nys-embed-throughput-measure.sh "daily-throughput"
cat /opt/nyv/embed-coverage-latest.json   # on worker via SSM
```

**Re-enable peak throttle after sprint:**
```bash
# Uncomment 10:00 line in scripts/_nys-embed-cnr-cron-install.sh, then:
bash scripts/_nys-embed-cnr-cron-install.sh
```

**ETA to ~95%:** ~6.06M remaining; need **~250k rows/h** for 24h finish. Post-fix target **~100–200k rows/h** (5 units × conc 10) → **~1.5–2.5 days** if stall loop stays fixed (vs prior **weeks** at ~77k/h during restart loop + peak throttle).

---

## 2026-09-03 embed accelerate (GO)

**Root cause (21:00 full resume):** `_phase-b-embed-resume.sh` only `systemctl start`ed units. It did **not** remove peak `throttle.conf` drop-ins (HC shards stayed at `EMBED_CONCURRENCY=2` / batch 50) or re-enable shards 2, DC, and statutes. Cron lines now wrap scripts with `echo === OFFPEAK/PEAK $(date -Is) ===` so `/var/log/nys-embed-cnr-schedule.log` is never silent.

**Window change:** peak starts **10:00 IST** (was 09:00); off-peak full resume **20:00 IST** (was 21:00) → **14 h** off-peak / **10 h** peak.

**Off-peak knobs:** `offpeak.conf` on all HC shards + DC: `EMBED_CONCURRENCY=6`, `EMBED_BATCH=100`, `RDS_STATEMENT_TIMEOUT_MS=120000`. Peak keeps `RDS_STATEMENT_TIMEOUT_MS=25000` for CNR-safe pool defaults.

**RDS timeouts:** `embed-corpus.mjs` retries once on Postgres `57014` for select/update/progress; deployed to `/opt/nyv/api/embed-corpus.mjs` (SSM chunk deploy `13923f01-082c-4b0f-a35d-ae9341406018`).

**Evidence (2026-09-03T02:26Z):** manual full resume SSM `ee9c3894-693c-43f6-a90a-2b4d6ddba7d2` — 5/5 units active, 4 embed PIDs; cron reinstall SSM `1f749612-2e8e-47f8-85e1-852b0647c183`.

**Coverage snapshot:** `embed-coverage-latest.json` ts `2026-09-03T02:33:19Z` still **76.64%** (API curl http=0 to local coverage endpoint; checkpoint `embed_progress` shows DC advancing). Re-run monitor when nyayasearch API is up for refreshed %.

**Rough ETA:** ~6.11M unembedded at prior probe; with 14h off-peak × 5 units @ conc 6 vs 10h × 2 @ conc 2, blended throughput ~**2.5–3×** → **~12–18 calendar days** to ~95% embed (assumes no Bedrock throttle).
