---
status: completed
version: 3.1.2
superseded_by: null
last_verified: 2026-04-25
---
# Nyayavigya Platform 3.1.2 — SDK Integration Guide

**Document Reference**: NYV-SDK-312-001
**For**: Consumer platforms (NSP, NYI, Nyayamitra, Academy, Governance)

---

## How to Integrate

### Step 1: Create an SDK App

Log in to the Nyayavigya Console (`http://your-nvp-domain:3004`) as a developer.

Navigate to **SDK Console → Create App** and fill in:
- App Name: e.g. "Nyayasiddhi Professional™"
- App Type: `nyayasiddhi_professional`
- Jurisdiction: `IN`
- Tier: `pro`

### Step 2: Generate an API Key

In the app detail page, click **Generate API Key**. Copy the key — it is shown only once.

Keys follow the format: `NYV-KEY-{random-64-chars}`

### Step 3: Make API Calls

All calls go to: `https://your-nvp-domain/api/nv/`

**Authentication**: Include the API key in the header:
```
X-NV-API-Key: NYV-KEY-your-key-here
```

### Step 4: Example — Run a Legal Agent

```typescript
const response = await fetch('https://nvp.example.com/api/nv/orchestration/run', {
  method: 'POST',
  headers: {
    'X-NV-API-Key': 'NYV-KEY-your-key',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    agentId: 'NYV-AGT-CIVIL-001',
    jurisdiction: 'IN',
    query: 'Explain the requirements for filing a civil suit under Order VII Rule 1 CPC',
    language: 'en'
  })
});

const result = await response.json();
console.log(result.response);
```

### Step 5: Example — Multi-Agent DAG

```typescript
const dagResponse = await fetch('https://nvp.example.com/api/nv/orchestration/dag', {
  method: 'POST',
  headers: { 'X-NV-API-Key': 'NYV-KEY-your-key', 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Contract Review Pipeline',
    steps: [
      { id: 'step1', agentId: 'NYV-AGT-CORPORATE-001', query: 'Review contract clauses' },
      { id: 'step2', agentId: 'NYV-AGT-LEGAL-DRAFTING-001', dependsOn: ['step1'], query: 'Suggest amendments' }
    ]
  })
});
```

## Rate Limits

| Tier | Limit |
|------|-------|
| Solo | 100 req/min |
| Plus | 300 req/min |
| Pro | 1,000 req/min |
| Enterprise | Unlimited |

## Error Codes

| Code | Meaning |
|------|---------|
| `NYV-AUTH-001` | Missing or invalid API key |
| `NYV-AUTH-002` | JWT expired |
| `NYV-RATE-001` | Rate limit exceeded |
| `NYV-AGENT-001` | Agent not found |
| `NYV-ORCH-001` | Orchestration job failed |
| `NYV-TIER-001` | Feature requires higher tier |
