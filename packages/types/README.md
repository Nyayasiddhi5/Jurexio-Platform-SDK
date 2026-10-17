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
type NyvSubscriptionTier = 'free' | 'solo' | 'plus' | 'pro' | 'enterprise' | 'government' | 'internal';
```

### Platforms (Jurexio)

```typescript
type NyvPlatform = 'nyayamitra' | 'nys-professional' | 'nys-institutional' | 'nys-academy' | 'nys-ministry';
```

### Jurisdictions

```typescript
type NyvJurisdiction = 'IN' | 'UK' | 'US' | 'EU' | 'GC' | 'SG';
```

### Legal Domains

```typescript
type NyvLegalDomain = 'criminal' | 'civil' | 'constitutional' | 'corporate' | 'tax' | 'ip' | 'family' | 'labour' | 'environmental' | 'cyber' | 'banking' | 'arbitration' | 'real-estate' | 'immigration' | 'consumer' | 'administrative';
```

### Agent Patterns (22 Patterns)

```typescript
type NyvAgentPattern =
  | 'cot' | 'react' | 'tot' | 'plan-and-execute' | 'multi-agent-debate'
  | 'tool-use' | 'reflection' | 'meta-prompting' | 'self-discover' | 'self-refine'
  | 'nyaya-rag' | 'mixture-of-agents' | 'parallel-tool-call' | 'constraint-satisfaction'
  | 'hierarchical-planning' | 'role-play' | 'verification-loop' | 'digital-twin'
  | 'a-b-testing' | 'multi-modal' | 'grpo' | 'self-improving';
```

## Category Exports

The package exports types organized by category:

- **Core**: `NyvSubscriptionTier`, `NyvPlatform`, `NyvJurisdiction`, `NyvLegalDomain`, `NyvAgentPattern`, `NyvRiskLevel`
- **SDK Config**: `NyvSdkTierLimits`
- **Webhook**: `NyvWebhookEvent`
- **Cache**: `NyvCacheEntry`, `NyvCacheStats`
- **Credits**: `NyvCreditWallet`, `NyvCreditTransaction`
- **Compliance**: `NyvEuComplianceReport`, `NyvBiasAuditReport`, `NyvWatermarkResult`, `NyvSigningSession`
- **Intelligence**: `NyvPrecedentSearchResult`, `NyvRegulatoryDigest`, `NyvComplianceCalendar`, `NyvContractAnalysis`, etc.
- **Testing**: `NyvOracleTestReport`, `NyvAdversarialTestReport`, `NyvLlmJudgeResult`, `NyvAgentScorecard`
- **Memory**: `NyvMatterMemory`, `NyvClientMemory`
- **Nyaya Tools**: `NyvGraphTraversalResult`, `NyvCitationCheckResult`, `NyvTemplateGenerateResult`, etc.

## Version

Platform v3.1.2
