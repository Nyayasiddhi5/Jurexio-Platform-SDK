# @jurexio/types

Canonical TypeScript type definitions for the Jurexio Legal AI Platform v3.1.2.

This package is the single source of truth for all shared types used across `@jurexio/client-sdk`, `@jurexio/enterprise-sdk`, and `@jurexio/react-hooks`.

## Installation

```bash
npm install @jurexio/types
```

## Key Types

### Subscription Tiers

```typescript
type JrxSubscriptionTier = 'free' | 'solo' | 'plus' | 'pro' | 'enterprise' | 'government' | 'internal';
```

### Platforms (Jurexio)

```typescript
type JrxPlatform = 'jurexio-citizen' | 'nys-professional' | 'nys-institutional' | 'nys-academy' | 'nys-ministry';
```

### Jurisdictions

```typescript
type JrxJurisdiction = 'IN' | 'UK' | 'US' | 'EU' | 'GC' | 'SG';
```

### Legal Domains

```typescript
type JrxLegalDomain = 'criminal' | 'civil' | 'constitutional' | 'corporate' | 'tax' | 'ip' | 'family' | 'labour' | 'environmental' | 'cyber' | 'banking' | 'arbitration' | 'real-estate' | 'immigration' | 'consumer' | 'administrative';
```

### Agent Patterns (22 Patterns)

```typescript
type JrxAgentPattern =
  | 'cot' | 'react' | 'tot' | 'plan-and-execute' | 'multi-agent-debate'
  | 'tool-use' | 'reflection' | 'meta-prompting' | 'self-discover' | 'self-refine'
  | 'nyaya-rag' | 'mixture-of-agents' | 'parallel-tool-call' | 'constraint-satisfaction'
  | 'hierarchical-planning' | 'role-play' | 'verification-loop' | 'digital-twin'
  | 'a-b-testing' | 'multi-modal' | 'grpo' | 'self-improving';
```

## Category Exports

The package exports types organized by category:

- **Core**: `JrxSubscriptionTier`, `JrxPlatform`, `JrxJurisdiction`, `JrxLegalDomain`, `JrxAgentPattern`, `JrxRiskLevel`
- **SDK Config**: `JrxSdkTierLimits`
- **Webhook**: `JrxWebhookEvent`
- **Cache**: `JrxCacheEntry`, `JrxCacheStats`
- **Credits**: `JrxCreditWallet`, `JrxCreditTransaction`
- **Compliance**: `JrxEuComplianceReport`, `JrxBiasAuditReport`, `JrxWatermarkResult`, `JrxSigningSession`
- **Intelligence**: `JrxPrecedentSearchResult`, `JrxRegulatoryDigest`, `JrxComplianceCalendar`, `JrxContractAnalysis`, etc.
- **Testing**: `JrxOracleTestReport`, `JrxAdversarialTestReport`, `JrxLlmJudgeResult`, `JrxAgentScorecard`
- **Memory**: `JrxMatterMemory`, `JrxClientMemory`
- **Nyaya Tools**: `JrxGraphTraversalResult`, `JrxCitationCheckResult`, `JrxTemplateGenerateResult`, etc.

## Version

Platform v3.1.2
