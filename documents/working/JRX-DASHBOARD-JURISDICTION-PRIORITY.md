# JRX dashboard — six-jurisdiction priority (USA & India first)

**Canonical order:** `shared/jrx-jurisdiction-catalog.ts` → **US, IN, UK, EU, SG, GC**

## Surfaces updated

| Surface | Change |
|---------|--------|
| Legal chat | Default `['US','IN']`; jurisdiction chips in catalog order |
| Document AI Hub | Default jurisdiction **US**; KPI sub-label |
| Jurisdiction mapping | Registry cards sorted by catalog order |
| API `/jurisdiction/registries/stats` | Jurisdictions sorted for dashboard |
| Agent registry stats | `getJurisdictionStats()` sorted |

## Workflows (product order)

1. **USA** — corpus ingest, federal drafting, PACER adapter path, eCFR/E1  
2. **India** — CNR, BNSS/BNS, strongest agent density, Open India Law E1  
3. **UK / EU / SG / GC** — E1/E2 ingest scaffolds, templates under `shared/jurisdiction-templates/`

## Ops (existing infra only)

After `git push origin main`:

```bash
bash scripts/jrx-deploy-aws-ssm.sh
npm run global:corpus:ingest:ec2
npm run us:corpus:ingest:ec2
```

No new AWS resources until operator confirms.
