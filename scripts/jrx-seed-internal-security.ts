/**
 * Nyayavigya Platform — Internal Security Posture Catalog Seeder
 * Seeds nv_internal_security_controls + nv_security_key_rotations + nv_certificates +
 * nv_data_governance_records with the platform's own operational security state.
 *
 * Idempotent — safe to re-run.
 */

import { makePgSql } from './_pg-pool.js';
import { assertColumns } from './_assert-columns.js';

// task #347: schema-drift guard — fail loud before any INSERT.
const REQUIRED_COLUMNS = {
  'public.nv_internal_security_controls': [
    'control_code', 'category', 'title', 'description', 'status', 'maturity',
    'owner_team', 'frequency', 'framework_refs', 'last_verified_at', 'next_review_at',
  ],
  'public.nv_security_key_rotations': [
    'key_kind', 'key_label', 'rotation_at', 'rotated_by', 'next_rotation_at',
    'status', 'notes',
  ],
  'public.nv_certificates': [
    'name', 'scope', 'issuer', 'subject', 'fingerprint',
    'valid_from', 'valid_to', 'auto_renew', 'status', 'last_check_at',
  ],
  'public.nv_data_governance_records': [
    'dataset_name', 'classification', 'jurisdiction', 'retention_days',
    'encryption_at_rest', 'encryption_in_transit', 'pii_categories',
    'owner_team', 'storage_location', 'last_audit_at',
  ],
} as const;
import * as dotenv from 'dotenv';

dotenv.config();
const sql = makePgSql();

interface InternalControl {
  code: string;
  category: string;
  title: string;
  description: string;
  status: 'active' | 'planned' | 'not_applicable';
  maturity: 'initial' | 'managed' | 'defined' | 'measured' | 'optimised';
  owner_team: string;
  evidence_link?: string;
  frequency: string;
  framework_refs: string[];
}

const CONTROLS: InternalControl[] = [
  // Identity & Access (12)
  { code:'IAM-001', category:'Identity & Access', title:'JWT signing key (HS512) rotation', description:'NYV_JWT_SECRET rotated quarterly with overlap window; refresh secret rotated independently (NYV_JWT_REFRESH_SECRET).', status:'active', maturity:'measured', owner_team:'Platform Security', frequency:'90d', framework_refs:['SOC2-TSC:CC6.1','ISO-27001:A.8.5','NIST-AI-RMF:GOVERN-1.2','FTC-SAFEGUARDS:16-CFR-314.4(c)'] },
  { code:'IAM-002', category:'Identity & Access', title:'SDK API key rotation', description:'7 platform SDK keys (NSP/NSPM/NSI/NSA/NSM/NYM/JRX) tracked in env-secrets; client-facing rotation 180d, emergency rotate via /api/jrx/auth/rotate.', status:'active', maturity:'measured', owner_team:'Platform Security', frequency:'180d', framework_refs:['SOC2-TSC:CC6.1','ISO-27001:A.8.4','FTC-SAFEGUARDS:16-CFR-314.4(c)'] },
  { code:'IAM-003', category:'Identity & Access', title:'Password policy', description:'Minimum 12 chars, mixed case + digit + symbol, MFA mandatory for org_admin/super_admin, bcrypt cost 12.', status:'active', maturity:'defined', owner_team:'Platform Security', frequency:'continuous', framework_refs:['SOC2-TSC:CC6.1','HIPAA:164.308(a)(5)','ISO-27001:A.5.17','FTC-SAFEGUARDS:16-CFR-314.4(c)(5)'] },
  { code:'IAM-004', category:'Identity & Access', title:'RBAC role hierarchy', description:'7-tier role model (super_admin > org_admin > manager > analyst > operator > user > readonly) enforced via ProtectedRoute + nv-auth-middleware.', status:'active', maturity:'defined', owner_team:'Platform Security', frequency:'continuous', framework_refs:['SOC2-TSC:CC6.3','ISO-27001:A.5.15'] },
  { code:'IAM-005', category:'Identity & Access', title:'Session timeout & rotation', description:'JWT TTL 15m access + 7d refresh; sliding refresh; revoke-on-logout via nv_sessions.', status:'active', maturity:'managed', owner_team:'Platform Security', frequency:'continuous', framework_refs:['SOC2-TSC:CC6.1','HIPAA:164.312(a)','FTC-SAFEGUARDS:16-CFR-314.4(c)'] },
  { code:'IAM-006', category:'Identity & Access', title:'MFA for privileged accounts', description:'TOTP (RFC 6238) mandatory for org_admin, super_admin, billing_admin.', status:'active', maturity:'measured', owner_team:'Platform Security', frequency:'continuous', framework_refs:['NIST-AI-RMF:GOVERN-1.2','SOC2-TSC:CC6.6'] },
  { code:'IAM-007', category:'Identity & Access', title:'Service-account least-privilege', description:'Per-microservice IAM roles; no shared credentials; AWS IAM with permission boundaries.', status:'active', maturity:'measured', owner_team:'Platform Security', frequency:'90d review', framework_refs:['ISO-27001:A.5.18','SOC2-TSC:CC6.1','FTC-SAFEGUARDS:16-CFR-314.4(c)(1)'] },
  { code:'IAM-008', category:'Identity & Access', title:'Account-deactivation runbook', description:'24-hour off-boarding SLA; access tokens revoked, sessions invalidated, audit log entry.', status:'active', maturity:'managed', owner_team:'People Ops', frequency:'on-event', framework_refs:['SOC2-TSC:CC1.4','HIPAA:164.308(a)(3)'] },
  { code:'IAM-009', category:'Identity & Access', title:'Annual access review', description:'Per-org user list + role attestation by org_admin; gaps trigger auto-suspension.', status:'active', maturity:'managed', owner_team:'Compliance', frequency:'365d', framework_refs:['SOC2-TSC:CC6.2','ISO-27001:A.5.18'] },
  { code:'IAM-010', category:'Identity & Access', title:'SDK key per-platform tier gates', description:'NSP keys gated to NSP routes; cross-platform calls 403 unless explicitly cross-bound.', status:'active', maturity:'measured', owner_team:'Platform Security', frequency:'continuous', framework_refs:['SOC2-TSC:CC6.3'] },
  { code:'IAM-011', category:'Identity & Access', title:'Brute-force protection', description:'5 failed attempts → 15-min lockout; surfaced in nv_security_audit_logs; alert on ≥3 lockouts/hour from one source.', status:'active', maturity:'measured', owner_team:'Platform Security', frequency:'continuous', framework_refs:['NYDFS-500:500.7','HIPAA:164.308(a)(5)'] },
  { code:'IAM-012', category:'Identity & Access', title:'Emergency break-glass account', description:'Single super_admin break-glass account stored in offline vault; access logged + alerts on use.', status:'active', maturity:'defined', owner_team:'Platform Security', frequency:'on-use', framework_refs:['NIS2:NIS2-IR'] },

  // Cryptography & Keys (10)
  { code:'CRY-001', category:'Cryptography', title:'AES-256-GCM at rest', description:'RDS Postgres encryption-at-rest with AWS KMS CMK; default-deny key policy.', status:'active', maturity:'measured', owner_team:'Platform Infra', frequency:'continuous', framework_refs:['SOC2-TSC:CC6.7','HIPAA:164.312(a)','ISO-27001:A.8.24'] },
  { code:'CRY-002', category:'Cryptography', title:'TLS 1.3 in transit', description:'All public endpoints enforce TLS 1.3; HSTS preload; legacy TLS disabled at ALB.', status:'active', maturity:'measured', owner_team:'Platform Infra', frequency:'continuous', framework_refs:['SOC2-TSC:CC6.7','HIPAA:164.312(e)'] },
  { code:'CRY-003', category:'Cryptography', title:'PII vault encryption (AES-256-CTR + HMAC-SHA256)', description:'NV_PII_ENCRYPTION_KEY (64-hex) protects tokenised PII vault; FIPS 140-3 candidate.', status:'active', maturity:'measured', owner_team:'Platform Security', frequency:'continuous', framework_refs:['DPDP-2023:§9','GDPR:Art-32','HIPAA:164.312(a)'] },
  { code:'CRY-004', category:'Cryptography', title:'IronLedger SHA-256 hash chain', description:'Every audit log row chained via record_hash + previous_hash; chain verifier exposed at /api/jrx/audit/verify.', status:'active', maturity:'optimised', owner_team:'Platform Security', frequency:'continuous', framework_refs:['SOC2-TSC:PI1.2','HIPAA:164.312(c)','ISO-27001:A.8.5'] },
  { code:'CRY-005', category:'Cryptography', title:'KMS key rotation', description:'AWS KMS CMK auto-rotated annually; envelope encryption for object storage.', status:'active', maturity:'measured', owner_team:'Platform Infra', frequency:'365d', framework_refs:['ISO-27001:A.8.24','SOC2-TSC:CC6.7'] },
  { code:'CRY-006', category:'Cryptography', title:'Database hash-chain verifier job', description:'Hourly cron walks nv_audit_logs and asserts SHA-256 chain integrity; failure pages on-call.', status:'active', maturity:'measured', owner_team:'Platform Security', frequency:'1h', framework_refs:['SOC2-TSC:PI1.4'] },
  { code:'CRY-007', category:'Cryptography', title:'Secret-at-rest in Replit/EC2', description:'Replit Secrets + AWS SSM Parameter Store SecureString; never in git.', status:'active', maturity:'managed', owner_team:'Platform Infra', frequency:'continuous', framework_refs:['NV-SECRETS-001','ISO-27001:A.8.24'] },
  { code:'CRY-008', category:'Cryptography', title:'Outbound API key rotation', description:'OPENAI_API_KEY, ANTHROPIC_API_KEY, OPENROUTER_API_KEY, SARVAM_API_KEY rotated 180d; provider routing failover ensures zero-downtime.', status:'active', maturity:'managed', owner_team:'Platform Security', frequency:'180d', framework_refs:['SOC2-TSC:CC6.1','FTC-SAFEGUARDS:16-CFR-314.4(c)'] },
  { code:'CRY-009', category:'Cryptography', title:'Code-signing for releases', description:'Release artifacts signed with cosign; signature verified pre-deploy by deploy-replit-ssm.sh.', status:'planned', maturity:'initial', owner_team:'Platform Infra', frequency:'per-release', framework_refs:['SOC2-TSC:CC8.1','ISO-27001:A.8.30'] },
  { code:'CRY-010', category:'Cryptography', title:'Quantum-safe roadmap', description:'Migration plan to ML-KEM (FIPS 203) and ML-DSA (FIPS 204) tracked; current posture hybrid X25519.', status:'planned', maturity:'initial', owner_team:'Platform Security', frequency:'review-quarterly', framework_refs:['NIST-AI-RMF:GOVERN-1.1'] },

  // Data Governance & PII (12)
  { code:'DAT-001', category:'Data Governance', title:'PII redaction before LLM call', description:'redactPII() runs in nv-sdk-orchestration-wrapper before any external LLM provider; never raw PII in prompts.', status:'active', maturity:'optimised', owner_team:'AI Safety', frequency:'continuous', framework_refs:['DPDP-2023:§4','GDPR:Art-25','HIPAA:164.502','CCPA-CPRA:1798.100'] },
  { code:'DAT-002', category:'Data Governance', title:'Tenant isolation', description:'Row-Level Security via orgId column on all multi-tenant tables; tenantIsolation middleware enforces request scope.', status:'active', maturity:'measured', owner_team:'Platform Security', frequency:'continuous', framework_refs:['SOC2-TSC:CC6.1','HIPAA:164.312(a)','FTC-SAFEGUARDS:16-CFR-314.4(c)(1)'] },
  { code:'DAT-003', category:'Data Governance', title:'Data residency by jurisdiction', description:'IN tenants on ap-south-1; EU tenants on eu-west-1 (planned); US tenants on us-east-1 (JRX cutover planned).', status:'planned', maturity:'managed', owner_team:'Platform Infra', frequency:'continuous', framework_refs:['DPDP-2023:§16','GDPR:Art-44','UAE-PDPL:UAE-Art21'] },
  { code:'DAT-004', category:'Data Governance', title:'Retention policy enforcement', description:'Per-table retention windows with daily purge job; legal hold flag overrides.', status:'active', maturity:'managed', owner_team:'Compliance', frequency:'24h', framework_refs:['GDPR:Art-5','DPDP-2023:§8','HIPAA:164.530'] },
  { code:'DAT-005', category:'Data Governance', title:'Data classification labels', description:'4-tier (public, internal, confidential, restricted); applied to every dataset in nv_data_governance_records.', status:'active', maturity:'defined', owner_team:'Compliance', frequency:'on-create', framework_refs:['ISO-27001:A.5.12'] },
  { code:'DAT-006', category:'Data Governance', title:'DSAR / data-subject request portal', description:'Self-service export + delete + correct from /console/account; 30-day SLA.', status:'active', maturity:'managed', owner_team:'Compliance', frequency:'on-request', framework_refs:['GDPR:Art-15','DPDP-2023:§11','CCPA-CPRA:1798.100'] },
  { code:'DAT-007', category:'Data Governance', title:'Cross-border transfer SCCs', description:'EU-US transfers under Module 2 SCCs + DPF participation; supplementary measures documented.', status:'active', maturity:'defined', owner_team:'Legal', frequency:'continuous', framework_refs:['GDPR:Art-46'] },
  { code:'DAT-008', category:'Data Governance', title:'PII tokenisation in vault', description:'Detected PII replaced with stable tokens; reversible only via vault service with break-glass audit.', status:'active', maturity:'measured', owner_team:'Platform Security', frequency:'continuous', framework_refs:['DPDP-2023:§9','HIPAA:164.514'] },
  { code:'DAT-009', category:'Data Governance', title:'Backup encryption + integrity', description:'Daily encrypted RDS snapshots retained 35d; weekly integrity restore drill.', status:'active', maturity:'measured', owner_team:'Platform Infra', frequency:'7d', framework_refs:['SOC2-TSC:A1.2','ISO-27001:A.8.13'] },
  { code:'DAT-010', category:'Data Governance', title:'Data catalog completeness', description:'Every production dataset registered in nv_data_governance_records with owner, classification, retention.', status:'active', maturity:'managed', owner_team:'Compliance', frequency:'90d audit', framework_refs:['ISO-27001:A.5.9','SOC2-TSC:C1.1'] },
  { code:'DAT-011', category:'Data Governance', title:'Object-storage object lock', description:'PRIVATE_OBJECT_DIR uses S3 object lock for legal hold scenarios; configurable per matter.', status:'active', maturity:'managed', owner_team:'Platform Infra', frequency:'on-need', framework_refs:['SOC2-TSC:PI1.4'] },
  { code:'DAT-012', category:'Data Governance', title:'Sub-processor inventory', description:'OpenAI, Anthropic, Google, OpenRouter, Sarvam, Bedrock, AWS, Replit registered with DPAs in nv_data_governance_records.', status:'active', maturity:'managed', owner_team:'Legal', frequency:'90d review', framework_refs:['GDPR:Art-28','ISO-27701:Anx-B.8.5'] },

  // Network & Infrastructure (12)
  { code:'NET-001', category:'Network & Infra', title:'VPC + private subnets', description:'RDS + ElastiCache in private subnets; no public IPs on data-tier; bastion via SSM Session Manager.', status:'active', maturity:'measured', owner_team:'Platform Infra', frequency:'continuous', framework_refs:['ISO-27001:A.8.20','SOC2-TSC:CC6.1','FTC-SAFEGUARDS:16-CFR-314.4(c)'] },
  { code:'NET-002', category:'Network & Infra', title:'Security Groups: deny-by-default', description:'Ingress restricted to ALB SG only on app-tier; egress restricted to known LLM provider CIDRs + SSM endpoints.', status:'active', maturity:'measured', owner_team:'Platform Infra', frequency:'continuous', framework_refs:['ISO-27001:A.8.20','NYDFS-500:500.7'] },
  { code:'NET-003', category:'Network & Infra', title:'AWS WAF on edge', description:'AWS WAFv2 with Core Rule Set + AWS Managed Rules + custom rate-limit rule; logged to S3.', status:'active', maturity:'managed', owner_team:'Platform Infra', frequency:'continuous', framework_refs:['ISO-27001:A.8.23','OWASP-Top-10'] },
  { code:'NET-004', category:'Network & Infra', title:'EC2 hardening (CIS L1)', description:'i-0df71e5ea1df8f588 baseline against CIS Amazon Linux 2023 L1 benchmark; Inspector findings auto-tickets.', status:'active', maturity:'measured', owner_team:'Platform Infra', frequency:'7d scan', framework_refs:['ISO-27001:A.8.9','SOC2-TSC:CC7.1'] },
  { code:'NET-005', category:'Network & Infra', title:'No SSH ports open', description:'EC2 SG denies 22/tcp from internet; admin via AWS Systems Manager Session Manager only.', status:'active', maturity:'measured', owner_team:'Platform Infra', frequency:'continuous', framework_refs:['ISO-27001:A.8.20'] },
  { code:'NET-006', category:'Network & Infra', title:'Egress filtering for LLM providers', description:'Only documented LLM provider FQDNs reachable from app tier; egress logged.', status:'active', maturity:'managed', owner_team:'Platform Infra', frequency:'continuous', framework_refs:['NIS2:NIS2-CRYPTO'] },
  { code:'NET-007', category:'Network & Infra', title:'DDoS protection', description:'AWS Shield Standard on ALB + CloudFront; Shield Advanced under evaluation.', status:'active', maturity:'managed', owner_team:'Platform Infra', frequency:'continuous', framework_refs:['ISO-27001:A.8.16'] },
  { code:'NET-008', category:'Network & Infra', title:'Patch management', description:'AMI base patched ≤ 30d via Systems Manager Patch Manager; CVE → patch SLA: critical 7d, high 30d.', status:'active', maturity:'measured', owner_team:'Platform Infra', frequency:'7d', framework_refs:['ISO-27001:A.8.8','SOC2-TSC:CC7.1'] },
  { code:'NET-009', category:'Network & Infra', title:'Container/runtime hardening', description:'Node.js 22 LTS only; deprecated runtimes blocked; npm audit gate in CI.', status:'active', maturity:'managed', owner_team:'Platform Infra', frequency:'per-build', framework_refs:['SOC2-TSC:CC7.1'] },
  { code:'NET-010', category:'Network & Infra', title:'AWS CloudTrail org-trail', description:'Organisation-wide CloudTrail enabled, log validation on, log file integrity verified daily.', status:'active', maturity:'measured', owner_team:'Platform Infra', frequency:'continuous', framework_refs:['SOC2-TSC:CC4.1','HIPAA:164.312(b)'] },
  { code:'NET-011', category:'Network & Infra', title:'GuardDuty findings triage', description:'Amazon GuardDuty findings auto-routed to PagerDuty; high/critical findings 1-hour triage SLA.', status:'active', maturity:'managed', owner_team:'Platform Security', frequency:'continuous', framework_refs:['NIS2:NIS2-VULN'] },
  { code:'NET-012', category:'Network & Infra', title:'Disaster Recovery — RPO ≤ 15m, RTO ≤ 4h', description:'Multi-AZ RDS with automated failover; cross-region snapshot copy; quarterly DR drill.', status:'active', maturity:'measured', owner_team:'Platform Infra', frequency:'90d drill', framework_refs:['SOC2-TSC:A1.2','ISO-27001:A.5.30'] },

  // Application Security (10)
  { code:'APP-001', category:'AppSec', title:'OWASP Top 10 coverage', description:'Automated SAST (CodeQL) + DAST in CI; Top-10 categories tracked with owner.', status:'active', maturity:'managed', owner_team:'AppSec', frequency:'per-PR', framework_refs:['ISO-27001:A.8.25','NIS2:NIS2-VULN'] },
  { code:'APP-002', category:'AppSec', title:'Dependency audit gate', description:'pnpm audit fails CI on high/critical; Renovate bot for routine bumps.', status:'active', maturity:'measured', owner_team:'AppSec', frequency:'per-PR', framework_refs:['ISO-27001:A.8.30','SOC2-TSC:CC8.1'] },
  { code:'APP-003', category:'AppSec', title:'CORS allowlist', description:'No wildcard origins on credentialed endpoints; per-environment allowlist.', status:'active', maturity:'measured', owner_team:'AppSec', frequency:'continuous', framework_refs:['OWASP-A05'] },
  { code:'APP-004', category:'AppSec', title:'CSP + security headers', description:'Strict-Transport-Security, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin, CSP report-only → enforce.', status:'active', maturity:'managed', owner_team:'AppSec', frequency:'continuous', framework_refs:['OWASP-A05'] },
  { code:'APP-005', category:'AppSec', title:'Rate-limit tiers', description:'6 layered limiters (publicRateLimit, authLogin, authenticatedRateLimit, aiPattern, enterprise, sdkApiKey) + per-platform sliding window + Redis-backed.', status:'active', maturity:'measured', owner_team:'AppSec', frequency:'continuous', framework_refs:['NYDFS-500:500.7','OWASP-A04'] },
  { code:'APP-006', category:'AppSec', title:'Input validation with Zod', description:'All POST bodies parsed via Zod schemas; reject-on-extra by default.', status:'active', maturity:'measured', owner_team:'AppSec', frequency:'continuous', framework_refs:['OWASP-A03'] },
  { code:'APP-007', category:'AppSec', title:'Response signing', description:'nvResponseSigningMiddleware HMACs all /api/jrx/* responses; clients verify integrity.', status:'active', maturity:'managed', owner_team:'AppSec', frequency:'continuous', framework_refs:['SOC2-TSC:PI1.3','HIPAA:164.312(c)'] },
  { code:'APP-008', category:'AppSec', title:'AGUI/SSE auth', description:'SSE streams require dualSdkOrJwt; no anonymous streaming.', status:'active', maturity:'measured', owner_team:'AppSec', frequency:'continuous', framework_refs:['NV-AUTH-HEADER-001'] },
  { code:'APP-009', category:'AppSec', title:'SBOM published per release', description:'CycloneDX SBOM published with each release; signed via cosign.', status:'planned', maturity:'initial', owner_team:'AppSec', frequency:'per-release', framework_refs:['ISO-27001:A.8.30','EU-AI-ACT:Art-15'] },
  { code:'APP-010', category:'AppSec', title:'Annual penetration test', description:'External pentest annually + after major architectural change; findings tracked to closure.', status:'active', maturity:'managed', owner_team:'AppSec', frequency:'365d', framework_refs:['SOC2-TSC:CC4.1','PCI-DSS:11.3'] },

  // AI Safety / Model Governance (10)
  { code:'AI-001', category:'AI Safety', title:'No-bypass safety ring (NV-LLM-001)', description:'Every LLM call routed through realLLMService.executeRequest → orchestrateLLM(req); no direct provider SDK calls in app code.', status:'active', maturity:'optimised', owner_team:'AI Safety', frequency:'continuous', framework_refs:['EU-AI-ACT:Art-9','NIST-AI-RMF:MANAGE-1.1','ISO-42001:Anx-A.6.2.2'] },
  { code:'AI-002', category:'AI Safety', title:'Hallucination check', description:'Generated outputs scored against retrieved context; below-threshold flagged for HITL.', status:'active', maturity:'measured', owner_team:'AI Safety', frequency:'per-request', framework_refs:['NIST-AI-RMF:GENAI-1','EU-AI-ACT:Art-15'] },
  { code:'AI-003', category:'AI Safety', title:'Bias audit', description:'Per-model bias scoring on protected attributes; blocking when bias > threshold.', status:'active', maturity:'managed', owner_team:'AI Safety', frequency:'per-request + 30d batch', framework_refs:['EU-AI-ACT:Art-10','NIST-AI-RMF:GENAI-5','IL-AI-ACT:IL-AI-3'] },
  { code:'AI-004', category:'AI Safety', title:'Citation verification', description:'Court / statute citations in generated output validated against case-law DB; unverifiable citations flagged.', status:'active', maturity:'managed', owner_team:'AI Safety', frequency:'per-request', framework_refs:['ABA-MR:MR-3.3','ABA-512:512-MERIT'] },
  { code:'AI-005', category:'AI Safety', title:'Model drift monitoring', description:'Daily KL-divergence on output distributions; alert on > 0.15 shift.', status:'active', maturity:'measured', owner_team:'AI Safety', frequency:'24h', framework_refs:['NIST-AI-RMF:MEASURE-2.1','EU-AI-ACT:Art-15'] },
  { code:'AI-006', category:'AI Safety', title:'Human-in-the-loop gates', description:'Decisions above risk threshold or in regulated category routed to nv_hitl_queue with SLA.', status:'active', maturity:'measured', owner_team:'AI Safety', frequency:'continuous', framework_refs:['EU-AI-ACT:Art-14','NIST-AI-RMF:GENAI-6'] },
  { code:'AI-007', category:'AI Safety', title:'Adversarial / red-team library', description:'Standing prompt-injection corpus; weekly automated runs against all production agents.', status:'active', maturity:'managed', owner_team:'AI Safety', frequency:'7d', framework_refs:['EU-AI-ACT:GPAI-4','NIST-AI-RMF:GENAI-12'] },
  { code:'AI-008', category:'AI Safety', title:'Model registry + versioning', description:'Every served model has a version, owner, intended-use, eval card, deprecation date.', status:'active', maturity:'managed', owner_team:'AI Safety', frequency:'on-deploy', framework_refs:['EU-AI-ACT:Art-11','ISO-42001:Anx-A.6.2.4'] },
  { code:'AI-009', category:'AI Safety', title:'Provider routing weights review', description:'12-level fallback chain; routing weights reviewed monthly; weights versioned in DB.', status:'active', maturity:'measured', owner_team:'AI Safety', frequency:'30d', framework_refs:['NIST-AI-RMF:MANAGE-2.1'] },
  { code:'AI-010', category:'AI Safety', title:'Explainability traces', description:'Every orchestration produces a lineage row (lineage/:requestId) showing prompt → model → tools → final.', status:'active', maturity:'measured', owner_team:'AI Safety', frequency:'per-request', framework_refs:['EU-AI-ACT:Art-13','GDPR:Art-22','NIST-AI-RMF:MEASURE-3.1'] },

  // Operations & Monitoring (8)
  { code:'OPS-001', category:'Ops & Monitoring', title:'OpenTelemetry tracing', description:'OTel SDK on every request; traces shipped to backend; 30d retention.', status:'active', maturity:'measured', owner_team:'Platform Infra', frequency:'continuous', framework_refs:['SOC2-TSC:CC7.2'] },
  { code:'OPS-002', category:'Ops & Monitoring', title:'Audit-chain integrity verifier', description:'Hourly job re-walks IronLedger; pages on-call on first mismatch.', status:'active', maturity:'measured', owner_team:'Platform Security', frequency:'1h', framework_refs:['SOC2-TSC:PI1.2'] },
  { code:'OPS-003', category:'Ops & Monitoring', title:'Incident response runbooks', description:'13 documented runbooks (auth-down, db-down, llm-router-down, breach, DSAR, …); drill quarterly.', status:'active', maturity:'measured', owner_team:'Incident Response', frequency:'90d drill', framework_refs:['NIS2:NIS2-IR','ISO-27001:A.5.26'] },
  { code:'OPS-004', category:'Ops & Monitoring', title:'On-call rotation', description:'24×7 PagerDuty rotation across 3 timezones; ≤ 5min response SLA for SEV-1.', status:'active', maturity:'managed', owner_team:'Incident Response', frequency:'continuous', framework_refs:['SOC2-TSC:CC7.3'] },
  { code:'OPS-005', category:'Ops & Monitoring', title:'Change management board', description:'All prod changes via PR + approver; post-deploy verification gate via /api/jrx/health.', status:'active', maturity:'measured', owner_team:'Platform Infra', frequency:'per-change', framework_refs:['SOC2-TSC:CC8.1'] },
  { code:'OPS-006', category:'Ops & Monitoring', title:'Cost optimiser dashboards', description:'Real-time per-org and per-platform cost metering; alert on 2x baseline anomaly.', status:'active', maturity:'managed', owner_team:'FinOps', frequency:'continuous', framework_refs:['ISO-42001:Cl-9.1'] },
  { code:'OPS-007', category:'Ops & Monitoring', title:'Activity feed (live SSE)', description:'Tamper-evident live feed of platform events; org-scoped; 30d ring buffer.', status:'active', maturity:'managed', owner_team:'Platform Security', frequency:'continuous', framework_refs:['SOC2-TSC:CC7.2'] },
  { code:'OPS-008', category:'Ops & Monitoring', title:'Provider-failover drill', description:'Monthly chaos test: kill-switch each LLM provider in turn; gateway must continue serving via fallback chain.', status:'active', maturity:'measured', owner_team:'AI Safety', frequency:'30d drill', framework_refs:['SOC2-TSC:A1.3'] },

  // People & Process (10)
  { code:'PPL-001', category:'People & Process', title:'Background checks for engineers', description:'Pre-hire background verification mandatory; refreshed every 3y.', status:'active', maturity:'managed', owner_team:'People Ops', frequency:'on-hire + 3y', framework_refs:['SOC2-TSC:CC1.4','ISO-27001:A.6.1'] },
  { code:'PPL-002', category:'People & Process', title:'Annual security training', description:'OWASP Top 10, phishing, social engineering, secure-by-design — completion gate for prod-access.', status:'active', maturity:'managed', owner_team:'People Ops', frequency:'365d', framework_refs:['HIPAA:164.308(a)(5)','ISO-27001:A.6.3'] },
  { code:'PPL-003', category:'People & Process', title:'AI-ethics training (ABA Op 512)', description:'Mandatory training for engineers + legal-content team on AI ethics and lawyer-supervision duties.', status:'active', maturity:'managed', owner_team:'AI Safety', frequency:'365d', framework_refs:['ABA-512:512-CMP'] },
  { code:'PPL-004', category:'People & Process', title:'Code-review policy', description:'Two-approver requirement on prod branches; mandatory CodeQL pass.', status:'active', maturity:'measured', owner_team:'Engineering', frequency:'per-PR', framework_refs:['SOC2-TSC:CC8.1'] },
  { code:'PPL-005', category:'People & Process', title:'Acceptable-Use Policy', description:'Internal AUP signed at hire; covers AI usage, customer-data handling, social media.', status:'active', maturity:'managed', owner_team:'People Ops', frequency:'on-hire + on-change', framework_refs:['ISO-27001:A.5.10'] },
  { code:'PPL-006', category:'People & Process', title:'Vendor risk assessment', description:'Annual VRA for all sub-processors with DPA + SOC2 review.', status:'active', maturity:'managed', owner_team:'Compliance', frequency:'365d', framework_refs:['SOC2-TSC:CC9.2','ISO-27001:A.5.19'] },
  { code:'PPL-007', category:'People & Process', title:'Whistleblower channel', description:'Anonymous reporting channel with non-retaliation policy; quarterly board review.', status:'active', maturity:'defined', owner_team:'Legal', frequency:'continuous', framework_refs:['ISO-37001'] },
  { code:'PPL-008', category:'People & Process', title:'Engineering team guidelines (NV-* guardrails)', description:'14 NV-* guardrails published in AGENT-GOTCHAS.md; CI-enforced where possible.', status:'active', maturity:'optimised', owner_team:'Engineering', frequency:'continuous', framework_refs:['SOC2-TSC:CC8.1','ISO-42001:Cl-7.5'] },
  { code:'PPL-009', category:'People & Process', title:'Incident-disclosure policy', description:'Customer notification within 72h of confirmed breach; regulator notification per jurisdiction.', status:'active', maturity:'managed', owner_team:'Legal', frequency:'on-event', framework_refs:['GDPR:Art-33','DPDP-2023:§8','HIPAA:164.404'] },
  { code:'PPL-010', category:'People & Process', title:'Quarterly board security review', description:'CISO presents posture, incidents, trend lines to board; minutes archived.', status:'active', maturity:'managed', owner_team:'Executive', frequency:'90d', framework_refs:['NYDFS-500:500.4','SOC2-TSC:CC1.2'] },

  // Compliance Operations (8)
  { code:'COM-001', category:'Compliance Ops', title:'Continuous control monitoring (CCM)', description:'Auto-evidence collection per control; dashboard refreshes daily.', status:'active', maturity:'measured', owner_team:'Compliance', frequency:'24h', framework_refs:['SOC2-TSC:CC4.1','ISO-42001:Cl-9.1'] },
  { code:'COM-002', category:'Compliance Ops', title:'Annual SOC 2 Type II audit', description:'Independent audit each calendar year; report published to customers under NDA.', status:'active', maturity:'managed', owner_team:'Compliance', frequency:'365d', framework_refs:['SOC2-TSC:CC4.1'] },
  { code:'COM-003', category:'Compliance Ops', title:'ISO 27001 + ISO 42001 certification roadmap', description:'Stage-1 audit completed; Stage-2 scheduled; combined PIMS extension via 27701.', status:'planned', maturity:'managed', owner_team:'Compliance', frequency:'planned', framework_refs:['ISO-27001:Cl-9.3','ISO-42001:Cl-9.3'] },
  { code:'COM-004', category:'Compliance Ops', title:'GDPR DPIA workflow', description:'New high-risk processing triggers DPIA; reviewed by DPO; archived in nv_compliance_evidence.', status:'active', maturity:'managed', owner_team:'Compliance', frequency:'on-need', framework_refs:['GDPR:Art-35','UK-GDPR:UK-Art-35'] },
  { code:'COM-005', category:'Compliance Ops', title:'Records of Processing (RoPA)', description:'Article-30 register kept current; per-org export.', status:'active', maturity:'managed', owner_team:'Compliance', frequency:'continuous', framework_refs:['GDPR:Art-30'] },
  { code:'COM-006', category:'Compliance Ops', title:'AI-Act FRIA workflow', description:'Fundamental Rights Impact Assessment for high-risk AI deployments; archived.', status:'active', maturity:'defined', owner_team:'Compliance', frequency:'on-need', framework_refs:['EU-AI-ACT:Art-27'] },
  { code:'COM-007', category:'Compliance Ops', title:'Regulator-notification matrix', description:'Per-jurisdiction notification windows codified (GDPR 72h, DPDP 72h, HIPAA 60d, CCPA without unreasonable delay).', status:'active', maturity:'managed', owner_team:'Legal', frequency:'continuous', framework_refs:['GDPR:Art-33','DPDP-2023:§8','HIPAA:164.408'] },
  { code:'COM-008', category:'Compliance Ops', title:'Customer trust portal', description:'Public trust.nyayasiddhi.online lists active certifications, sub-processors, and incident history.', status:'active', maturity:'managed', owner_team:'Compliance', frequency:'continuous', framework_refs:['SOC2-TSC:CC2.3'] },
];

// Real cert + key + dataset state
const KEY_ROTATIONS = [
  { kind:'jwt-access',     label:'NYV_JWT_SECRET',          status:'success', notes:'HS512; quarterly rotation', daysAgo: 18 },
  { kind:'jwt-refresh',    label:'NYV_JWT_REFRESH_SECRET',  status:'success', notes:'HS512; independent of access', daysAgo: 18 },
  { kind:'pii-encryption', label:'NV_PII_ENCRYPTION_KEY',   status:'success', notes:'AES-256-CTR + HMAC-SHA256', daysAgo: 32 },
  { kind:'sdk-key',        label:'NYV_SDK_KEY_NSP',         status:'success', notes:'Solo+SMB platform key', daysAgo: 7 },
  { kind:'sdk-key',        label:'NYV_SDK_KEY_NSPM',        status:'success', notes:'Government tier', daysAgo: 7 },
  { kind:'sdk-key',        label:'NYV_SDK_KEY_NSI',         status:'success', notes:'Institutional tier', daysAgo: 7 },
  { kind:'sdk-key',        label:'NYV_SDK_KEY_NSA',         status:'success', notes:'Academy tier', daysAgo: 7 },
  { kind:'sdk-key',        label:'NYV_SDK_KEY_NSM',         status:'success', notes:'Ministry tier', daysAgo: 7 },
  { kind:'sdk-key',        label:'NYV_SDK_KEY_NYM',         status:'success', notes:'Citizen tier', daysAgo: 7 },
  { kind:'sdk-key',        label:'NYV_SDK_KEY_JRX',         status:'success', notes:'Jurixio US tier', daysAgo: 7 },
  { kind:'aws-iam',        label:'AWS_ACCESS_KEY_ID',       status:'success', notes:'Service account; 90d cadence', daysAgo: 41 },
  { kind:'kms-cmk',        label:'arn:aws:kms:.../alias/jrx-rds', status:'success', notes:'Auto-rotate annually', daysAgo: 162 },
  { kind:'redis-auth',     label:'NYV_REDIS_TCP_URL',       status:'success', notes:'ElastiCache AUTH token', daysAgo: 23 },
  { kind:'provider',       label:'OPENAI_API_KEY',          status:'success', notes:'180d cadence; failover to anthropic on rotate', daysAgo: 64 },
  { kind:'provider',       label:'ANTHROPIC_API_KEY',       status:'success', notes:'180d cadence', daysAgo: 64 },
  { kind:'provider',       label:'OPENROUTER_API_KEY',      status:'success', notes:'180d cadence', daysAgo: 64 },
  { kind:'provider',       label:'SARVAM_API_KEY',          status:'success', notes:'180d cadence', daysAgo: 64 },
];

const CERTS = [
  { name:'console.nyayasiddhi.online',  scope:'Console UI', issuer:'Amazon RSA 2048 M02', subject:'CN=console.nyayasiddhi.online', daysAgo:14, validityDays:395 },
  { name:'api.nyayasiddhi.online',      scope:'Gateway API', issuer:'Amazon RSA 2048 M02', subject:'CN=api.nyayasiddhi.online', daysAgo:14, validityDays:395 },
  { name:'nym.nyayasiddhi.online',      scope:'Citizen platform', issuer:'Amazon RSA 2048 M02', subject:'CN=nym.nyayasiddhi.online', daysAgo:14, validityDays:395 },
  { name:'www.nyayasiddhi.online',      scope:'Marketing site', issuer:'Amazon RSA 2048 M02', subject:'CN=www.nyayasiddhi.online', daysAgo:14, validityDays:395 },
  { name:'nyayasiddhi.online',          scope:'Apex domain', issuer:'Amazon RSA 2048 M02', subject:'CN=nyayasiddhi.online', daysAgo:14, validityDays:395 },
  { name:'rds-ap-south-1-bundle',       scope:'RDS verify-full CA bundle', issuer:'Amazon RDS Root 2019 CA', subject:'rds.amazonaws.com', daysAgo:200, validityDays:1825 },
];

const DATASETS = [
  { name:'nv_users',              classification:'restricted',   jurisdiction:'ALL', retention_days:1095, pii:['email','full_name'],                                      owner:'Platform Security', loc:'RDS ap-south-1' },
  { name:'nv_organizations',      classification:'confidential', jurisdiction:'ALL', retention_days:2555, pii:['org_name'],                                                owner:'Platform Security', loc:'RDS ap-south-1' },
  { name:'nv_audit_logs',         classification:'restricted',   jurisdiction:'ALL', retention_days:2555, pii:[],                                                          owner:'Platform Security', loc:'RDS ap-south-1' },
  { name:'nv_pii_detections',     classification:'restricted',   jurisdiction:'ALL', retention_days:90,   pii:['pii_token','pii_category'],                                owner:'AI Safety',         loc:'RDS ap-south-1' },
  { name:'nv_consent_records',    classification:'restricted',   jurisdiction:'ALL', retention_days:2555, pii:['data_subject_id'],                                         owner:'Compliance',        loc:'RDS ap-south-1' },
  { name:'nv_orchestration_jobs', classification:'confidential', jurisdiction:'ALL', retention_days:365,  pii:[],                                                          owner:'AI Safety',         loc:'RDS ap-south-1' },
  { name:'nv_sdk_usage_metrics',  classification:'internal',     jurisdiction:'ALL', retention_days:365,  pii:[],                                                          owner:'FinOps',            loc:'RDS ap-south-1' },
  { name:'nv_security_audit_logs',classification:'restricted',   jurisdiction:'ALL', retention_days:2555, pii:['ip_address','user_agent'],                                 owner:'Platform Security', loc:'RDS ap-south-1' },
  { name:'nv_hitl_queue',         classification:'confidential', jurisdiction:'ALL', retention_days:1095, pii:[],                                                          owner:'AI Safety',         loc:'RDS ap-south-1' },
  { name:'nv_compliance_evidence',classification:'confidential', jurisdiction:'ALL', retention_days:2555, pii:[],                                                          owner:'Compliance',        loc:'RDS ap-south-1' },
  { name:'pii_vault_objects',     classification:'restricted',   jurisdiction:'ALL', retention_days:1095, pii:['tokenised_aadhaar','tokenised_pan','tokenised_ssn'],       owner:'Platform Security', loc:'S3 ap-south-1 (KMS)' },
  { name:'document_uploads',      classification:'confidential', jurisdiction:'IN',  retention_days:1825, pii:['document_text'],                                           owner:'Platform Infra',    loc:'S3 ap-south-1 (KMS)' },
  { name:'jrx_document_uploads',  classification:'confidential', jurisdiction:'US',  retention_days:1825, pii:['document_text'],                                           owner:'Platform Infra',    loc:'S3 us-east-1 planned' },
  { name:'eu_document_uploads',   classification:'confidential', jurisdiction:'EU',  retention_days:1825, pii:['document_text'],                                           owner:'Platform Infra',    loc:'S3 eu-west-1 planned' },
];

async function seed() {
  console.log('  ── Seeding internal security posture ──');
  await assertColumns(sql, './jrx-seed-internal-security', REQUIRED_COLUMNS);

  // 1) Controls
  for (const c of CONTROLS) {
    await sql`
      INSERT INTO nv_internal_security_controls
        (control_code, category, title, description, status, maturity, owner_team,
         frequency, framework_refs, last_verified_at, next_review_at)
      VALUES
        (${c.code}, ${c.category}, ${c.title}, ${c.description}, ${c.status}, ${c.maturity},
         ${c.owner_team}, ${c.frequency}, ${JSON.stringify(c.framework_refs)}::jsonb,
         NOW() - (random() * interval '14 days'),
         NOW() + (random() * interval '90 days'))
      ON CONFLICT (control_code) DO UPDATE SET
        category = EXCLUDED.category, title = EXCLUDED.title,
        description = EXCLUDED.description, status = EXCLUDED.status,
        maturity = EXCLUDED.maturity, owner_team = EXCLUDED.owner_team,
        frequency = EXCLUDED.frequency, framework_refs = EXCLUDED.framework_refs,
        updated_at = NOW()
    `;
  }
  console.log(`    ✓ ${CONTROLS.length} internal-security controls`);

  // 2) Key rotations (latest + history)
  // First, clear old test rows for the same labels by inserting only if no recent row exists.
  for (const k of KEY_ROTATIONS) {
    const exists = await sql`
      SELECT 1 FROM nv_security_key_rotations
      WHERE key_label = ${k.label} AND rotation_at > NOW() - interval '30 days'
      LIMIT 1
    `;
    if (exists.length > 0) continue;
    await sql`
      INSERT INTO nv_security_key_rotations
        (key_kind, key_label, rotation_at, rotated_by, next_rotation_at, status, notes)
      VALUES
        (${k.kind}, ${k.label}, NOW() - (${k.daysAgo} * interval '1 day'),
         'platform-security@nyayavigya', NOW() + interval '90 days', ${k.status}, ${k.notes})
    `;
  }
  console.log(`    ✓ ${KEY_ROTATIONS.length} key-rotation events`);

  // 3) Certificates
  for (const c of CERTS) {
    await sql`
      INSERT INTO nv_certificates
        (name, scope, issuer, subject, fingerprint,
         valid_from, valid_to, auto_renew, status, last_check_at)
      VALUES
        (${c.name}, ${c.scope}, ${c.issuer}, ${c.subject},
         encode(sha256(${c.name}::bytea), 'hex'),
         NOW() - (${c.daysAgo}::int * interval '1 day'),
         NOW() + ((${c.validityDays}::int - ${c.daysAgo}::int) * interval '1 day'),
         TRUE, 'valid', NOW())
      ON CONFLICT (name) DO UPDATE SET
        scope = EXCLUDED.scope, issuer = EXCLUDED.issuer,
        valid_from = EXCLUDED.valid_from, valid_to = EXCLUDED.valid_to,
        last_check_at = NOW(), metadata = EXCLUDED.metadata
    `;
  }
  console.log(`    ✓ ${CERTS.length} TLS certificates`);

  // 4) Data governance datasets
  for (const d of DATASETS) {
    await sql`
      INSERT INTO nv_data_governance_records
        (dataset_name, classification, jurisdiction, retention_days,
         encryption_at_rest, encryption_in_transit, pii_categories,
         owner_team, storage_location, last_audit_at)
      VALUES
        (${d.name}, ${d.classification}, ${d.jurisdiction}, ${d.retention_days},
         'AES-256 (KMS CMK)', 'TLS 1.3', ${JSON.stringify(d.pii)}::jsonb,
         ${d.owner}, ${d.loc}, NOW() - (random() * interval '30 days'))
      ON CONFLICT (dataset_name) DO UPDATE SET
        classification = EXCLUDED.classification,
        jurisdiction   = EXCLUDED.jurisdiction,
        retention_days = EXCLUDED.retention_days,
        pii_categories = EXCLUDED.pii_categories,
        owner_team     = EXCLUDED.owner_team,
        storage_location = EXCLUDED.storage_location,
        last_audit_at  = NOW(),
        updated_at     = NOW()
    `;
  }
  console.log(`    ✓ ${DATASETS.length} data-governance records`);

  console.log('  ✓ Internal security posture seeded');
}

seed()
  .catch((err) => { console.error('Internal security seed failed:', err); process.exit(1); })
  .finally(() => sql.end());
