# @jurexio/react-hooks

React hooks for integrating with Jurexio Legal AI Platform v3.1.2.

## Installation

```bash
npm install @jurexio/react-hooks @jurexio/types react
```

## Quick Start

```tsx
import { useJrxClient, usePatternStream, useGovernanceBadge } from '@jurexio/react-hooks';

function LegalAssistant() {
  const { initialize, isReady, getHeaders } = useJrxClient({
    apiKey: 'nyv_live_sk_your_key',
    baseUrl: 'https://app.jurexio.com',
  });

  const { stream, tokens, isStreaming, governance } = usePatternStream({
    apiKey: 'nyv_live_sk_your_key',
    pattern: 'P11',
    jurisdiction: 'IN',
    onComplete: (text) => console.log('Response:', text),
  });

  return (
    <div>
      <button onClick={() => stream('Explain BNS Section 103')}>Ask</button>
      {isStreaming && <p>Thinking...</p>}
      <pre>{tokens}</pre>
      {governance && <GovernanceBadge score={governance.risk_score} />}
    </div>
  );
}
```

## Available Hooks

### useJrxClient

Client configuration and auth header management.

```tsx
const {
  isReady,
  config,
  baseUrl,
  authHeaders,
  initialize,
  reset,
  getHeaders,
} = useJrxClient({ apiKey: '...', baseUrl: '...' });
```

### usePatternStream

SSE streaming for all 22 AI patterns via AG-UI protocol.

```tsx
const {
  isStreaming, tokens, fullResponse, governance, error,
  stream, abort, reset,
} = usePatternStream({
  apiKey: '...',
  pattern: 'P01',
  onToken: (t) => {},
  onGovernance: (g) => {},
});
```

### useCredits

Credit wallet management with auto-refetch.

```tsx
const {
  wallet, transactions, isLoading, error,
  refetch, deduct, recharge, hasEnough,
} = useCredits({
  apiKey: '...',
  userId: 'user-123',
  autoRefetch: true,
  refetchIntervalMs: 30000,
});
```

### useGovernanceBadge

Compute risk badge, color, and label from a risk score (0-1).

```tsx
const badge = useGovernanceBadge({ riskScore: 0.35, auditHash: '...' });
// badge.badge === 'MEDIUM'
// badge.color === '#d97706'
// badge.description === 'AI output requires human review...'
```

### useJurisdiction

Multi-jurisdiction context with supported patterns.

```tsx
const {
  jurisdiction, info, allJurisdictions,
  setJurisdiction, isIndia, requiresGST, supportedPatterns,
} = useJurisdiction('IN');
```

### useAuditLog

Audit trail with hash-chain verification.

```tsx
const { entries, isLoading, refetch, verifyChain } = useAuditLog({
  apiKey: '...',
  userId: 'user-123',
});
const chainValid = verifyChain();
```

### useIntelligence

Precedent search, regulatory digest, contract analysis, readability scoring, NER.

```tsx
const { findPrecedents, analyzeContract, extractEntities } = useIntelligence();
```

### useAgentTesting

Oracle tests, adversarial tests, LLM judge, scorecard generation.

```tsx
const { runOracleTests, runAdversarialTests, evaluateWithJudge } = useAgentTesting();
```

### useCompliance

EU AI Act report and bias audit access.

```tsx
const { getEuComplianceReport, getBiasAudit } = useCompliance();
```

### useConflictDetector

Conflict of interest detection.

```tsx
const { detect, result } = useConflictDetector();
await detect([{ name: 'Acme', role: 'plaintiff' }], 'MATTER-001');
```

### useAmendmentImpact

Amendment impact analysis.

```tsx
const { analyze, result } = useAmendmentImpact();
await analyze('BNS-2023-A1', 'IN');
```

### useTemplateAssistant

Legal template listing, generation, and fill sessions.

```tsx
const { listTemplates, generate, startFillSession } = useTemplateAssistant();
```

### useTimeline

Limitation period calculator and procedural checklists.

```tsx
const { checkLimitation, getChecklist } = useTimeline();
```

### useForensicVerifier

Document forensic verification.

```tsx
const { verify, result } = useForensicVerifier();
```

### useRegulatoryFeed

Real-time regulatory feed.

```tsx
const { fetchFeed, digest } = useRegulatoryFeed();
```

### usePrecedentSimilarity

Dedicated precedent similarity search.

```tsx
const { search, result } = usePrecedentSimilarity();
```

## Supported Jurisdictions

`IN` (India) | `UK` | `US` | `EU` | `GC` (Gulf) | `SG` (Singapore)

## Version

SDK v5.0.0 | Platform v3.1.2
