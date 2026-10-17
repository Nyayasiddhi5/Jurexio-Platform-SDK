# Legacy compose (archived)

Legacy compose files were moved to `archive/deprecated-nyv-compose/`. Jurexio deploy uses:

| Use case | Compose file |
|----------|----------------|
| EC2 production / smoke | `docker-compose.jurexio-aws.yml` |
| Local dev | `docker-compose.jurexio-local.yml` |

Operator path: `scripts/jrx-deploy-aws-ssm.sh`.
