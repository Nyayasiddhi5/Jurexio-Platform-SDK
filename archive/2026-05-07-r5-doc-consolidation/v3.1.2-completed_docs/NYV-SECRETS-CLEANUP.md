---
status: completed
version: 3.1.2
superseded_by: null
last_verified: 2026-04-25
---
# Secrets cleanup checklist

After running `bash scripts/secrets-sync.sh prod .env.prod` and verifying the
gateway boots happily against AWS Secrets Manager, follow this checklist to
remove stale local copies of secrets.

## 1. Replit project secrets

Open the Replit Secrets pane and remove every key that is now in AWS
Secrets Manager. The keys below were detected via `grep` of `.env.example`
on 2026-04-24 and are the canonical SM-managed set. **Verify by listing
secrets in SM first**:

```bash
aws secretsmanager list-secrets --region ap-south-1 \
  --filters "Key=tag-key,Values=Project" "Key=tag-value,Values=Nyayavigya" \
  --query 'SecretList[].Name' --output text | tr '\t' '\n' | sort
```

Then in Replit Secrets, delete:

- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `OPENROUTER_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_AI_API_KEY`
- `GROQ_API_KEY`
- `PERPLEXITY_API_KEY`
- `SARVAM_API_KEY`
- `ELEVENLABS_API_KEY`
- `SENTRY_DSN`
- `SESSION_SECRET`

**KEEP** in Replit Secrets:

- `NYV_DEPLOY_HOST` (deploy script needs it locally)
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (only if Replit needs to
  call AWS APIs from your dev terminal)
- Anything used only for Replit-side dev (e.g. `DEV_MOCK_PROVIDER`)

## 2. Local checked-in `.env*` files

Before deleting, confirm the file is excluded from the deploy tarball:

```bash
grep -E '^.env' nyayavigya-platform-312/scripts/deploy-replit-direct.sh
```

You should see `--exclude='.env'` and `--exclude='.env.*'` in the tar
command. Then:

```bash
# Optional: keep an offline copy first (encrypted, OUT of git)
gpg -c --cipher-algo aes256 .env.prod > ~/secure/nyayavigya/.env.prod.gpg
gpg -c --cipher-algo aes256 .env.staging > ~/secure/nyayavigya/.env.staging.gpg

# Then delete from the working tree
rm -f .env.prod .env.staging

# .env (dev only) STAYS — it has placeholder/dev values, never real prod secrets.
```

## 3. Search the whole tree for accidental commits

```bash
# regex covers OpenAI, Anthropic, Google, Groq, AWS, GitHub, Slack, Sarvam-shaped
RE='sk-[A-Za-z0-9]{40,}|sk-ant-api03-[A-Za-z0-9_-]{40,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}'

grep -rEn --binary-files=without-match \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=archive \
  --exclude='*.md' --exclude='.env.example' --exclude='*.lock' \
  "$RE" . | head -100
```

If anything matches, treat it as a secret leak: rotate immediately in the
upstream provider, then move the value into AWS Secrets Manager and remove
the literal from the source file in a single commit.

## 4. SSH key hygiene

The deploy SSH key under `.local/keys/nysdev.pem` (chmod 600) is currently
used by the deploy script. The bootstrap-fresh-ec2 process documents
swapping it for a dedicated `deploy@` user with its own key
(`.local/keys/nyv_to_ec2`). After the swap:

- [ ] `nyv_to_ec2` is the only key in `~deploy/.ssh/authorized_keys` on EC2
- [ ] `nysdev.pem` is REMOVED from EC2's `~ubuntu/.ssh/authorized_keys`
      (or its public key counterpart is)
- [ ] Update `NYV_DEPLOY_USER=deploy` and `NYV_DEPLOY_SSH_KEY=.local/keys/nyv_to_ec2`
      in Replit Secrets (or set them in the script's defaults)

## 5. After cleanup — verify the gateway still boots

A simple round-trip test:

```bash
ssh ubuntu@13.232.165.242 \
  'cd /opt/nyayavigya/repo/nyayavigya-platform-312 && \
   docker compose -f docker-compose.ecosystem.yml restart gateway-a && \
   sleep 30 && \
   curl -s http://127.0.0.1/health'
```

Expected: `200 ok` (or the JSON body your `/health` returns).

If it fails, the secrets-entrypoint logs (visible via
`docker logs nyv-gateway-a`) tell you which secret name is missing or still
has the `PLACEHOLDER_NOT_YET_SET` sentinel.

## 6. Sign-off

```
[ ] Replit secrets cleaned   (initials: ___)  date: ____
[ ] Local .env.prod removed  (initials: ___)  date: ____
[ ] Tree-wide grep clean     (initials: ___)  date: ____
[ ] SSH key swap done        (initials: ___)  date: ____
[ ] Gateway healthy after    (initials: ___)  date: ____
```
