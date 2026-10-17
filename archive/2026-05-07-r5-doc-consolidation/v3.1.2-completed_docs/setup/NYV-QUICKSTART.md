---
status: completed
version: 3.1.2
superseded_by: null
last_verified: 2026-04-25
---
# Nyayavigya Platform 3.1.2 — Quick Start Guide

**Document Reference**: NYV-SETUP-312-001

---

## Prerequisites

- Node.js 22+ (check: `node --version`)
- A PostgreSQL database URL from [Neon.tech](https://neon.tech) (free tier works)
- At minimum: one AI provider API key (OpenAI, Anthropic, or Google)

---

## Step 1: Create Replit Project

1. Go to [replit.com](https://replit.com) → Create Repl
2. Upload/unzip the `nyayavigya-platform-312.zip` file
3. Replit detects `package.json` → Node.js environment

---

## Step 2: Configure Secrets

In Replit, go to **Secrets** (lock icon) and add:

**Required (must have)**:
```
DATABASE_URL         → postgres://...@neon.tech/nvp312
NYV_JWT_SECRET       → (generate 64+ random chars)
NYV_JWT_REFRESH_SECRET → (generate 64+ different random chars)
OPENAI_API_KEY       → sk-...
```

**Recommended (for full functionality)**:
```
ANTHROPIC_API_KEY    → sk-ant-...
GOOGLE_AI_API_KEY    → AIza...
OPENROUTER_API_KEY   → sk-or-...
SARVAM_API_KEY       → (for 22 Indian languages)
```

**Optional**:
```
GROQ_API_KEY, PERPLEXITY_API_KEY, REPLICATE_API_TOKEN,
GITHUB_TOKEN, GOOGLE_CLOUD_PROJECT, GOOGLE_STORAGE_BUCKET
```

---

## Step 3: Install Dependencies

In Replit Shell:
```bash
npm install
```

---

## Step 4: Run Database Migration

```bash
npm run migrate
```

Creates all 30 `nv_*` tables in your Neon database.

---

## Step 5: Seed Master Data

```bash
npm run seed:all
```

This seeds (in order):
1. Feature flags (15 flags)
2. Jurisdiction configs (6 jurisdictions)
3. LLM providers (23 providers)
4. Demo organizations (4 orgs)
5. Demo users (6 users)
6. SDK applications (5 apps)
7. Legal agents (452 agents from nv-agents-registry.json)
8. MCP tools (10 tools)

---

## Step 6: Configure Replit Workflows

In Replit, go to **Workflows** and create:

**Workflow 1 — NYV Gateway**
- Command: `bash scripts/nv-start-dev.sh`
- Port: `5000`

**Workflow 2 — NYV Console**
- Command: `bash scripts/nv-start-console.sh`
- Port: `3004`

---

## Step 7: Verify

1. Start **NYV Gateway** workflow → visit `https://your-repl.replit.app/api/nv/health`
   - Should return: `{ "status": "healthy", "version": "3.1.2" }`

2. Start **NYV Console** workflow → visit `https://your-repl.replit.app:3004`
   - Login with the demo account `dev@demo.nyayavigya.in`; password is
     operator-managed (request out-of-band per NYV-SECURITY-DOC-CREDS-001
     — see `NYV-SDK-v5-INTEGRATION-GUIDE.md` §14.1).

3. Test an agent call:
```bash
curl -X POST https://your-repl.replit.app/api/nv/orchestration/run \
  -H "Authorization: Bearer <your-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"NYV-AGT-CIVIL-001","jurisdiction":"IN","query":"Explain Order VII Rule 1 CPC"}'
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Port 5000 already in use | The startup script auto-kills it — wait 10s |
| Database connection fails | Verify `DATABASE_URL` in secrets, check Neon DB is active |
| Agent registry empty | Run `npm run seed:agents` manually |
| 401 on all endpoints | Verify `NYV_JWT_SECRET` is set and 64+ chars |
| AI call fails | Ensure at least one of OPENAI/ANTHROPIC/GOOGLE API key is set |
