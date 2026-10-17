# NYV Docker Compose — do not use for Jurexio

These files remain in the repository for **Nyayavigya / nysdev lineage only**. Jurexio Enterprise deploy must use:

| Use case | Compose file |
|----------|----------------|
| EC2 production / smoke | `docker-compose.jurexio-aws.yml` |
| Local dev | `docker-compose.jurexio-local.yml` |

## Do not use for JRX

| File | Why |
|------|-----|
| `docker-compose.aws-dev.yml` | nysdev EC2 stack (`/opt/Nyayavigya`) |
| `docker-compose.ecosystem.yml` | Multi-product NYV ecosystem |
| `docker-compose.staging.yml` | Legacy staging |
| `docker-compose.yml` / `docker-compose.local.yml` | Generic NYV local — superseded by `docker-compose.jurexio-local.yml` |

Operator deploy path: `scripts/jrx-deploy-aws-ssm.sh` (refuses nysdev instance IDs).

NYV probe scripts relocated to `scripts/legacy-nyv/` — not part of JRX CI or deploy tarball workflows.
