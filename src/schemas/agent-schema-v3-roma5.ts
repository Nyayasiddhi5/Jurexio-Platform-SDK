import { z } from 'zod';

const QuantumReadySchema = z.object({
  mlKemLevel: z.enum(['512', '1024']).default('1024'),
  mlDsaLevel: z.enum(['44', '65', '87']).default('87'),
  zkpCircuit: z.enum(['PLONK', 'GROTH16', 'STARK']).default('PLONK'),
  postQuantumEnabled: z.boolean().default(true),
});

const GuardrailsSchema = z.object({
  parlantCompliant: z.boolean().default(true),
  bmadCompliant: z.boolean().default(true),
  antiHallucination: z.boolean().default(true),
  piiProtection: z.boolean().default(true),
  requiresCitation: z.boolean().default(true),
  biasDetection: z.boolean().default(true),
  hitlEnabled: z.boolean().default(true),
  grpoFeedback: z.boolean().default(true),
});

const ComplianceSchema = z.object({
  dpdpApplicable: z.boolean().default(false),
  gdprApplicable: z.boolean().default(false),
  ukGdprApplicable: z.boolean().optional(),
  hipaaApplicable: z.boolean().default(false),
  aiActApplicable: z.boolean().default(false),
  pdpaApplicable: z.boolean().default(false),
  uaePdpaApplicable: z.boolean().optional(),
  islamicFinance: z.boolean().optional(),
  masRegulated: z.boolean().optional(),
  fcaRegulated: z.boolean().optional(),
  secRegulated: z.boolean().optional(),
  logLevel: z.enum(['legal-grade', 'regulatory', 'standard']),
  dataResidency: z.string().min(1),
  auditRetentionYears: z.number().int().min(7),
});

const SLMBindingSchema = z.object({
  primarySLM: z.enum([
    'NS-SLM-IND', 'NS-SLM-UK', 'NS-SLM-GCC',
    'NS-SLM-EU', 'NS-SLM-USA', 'NS-SLM-SGP',
  ]),
  fallbackSLM: z.array(z.string()).min(1),
  requiresLRM: z.literal(true),
});

export const AgentSchemaV3 = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'ID must be kebab-case'),
  name: z.string().min(3),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Must be semver'),
  tier: z.enum(['orchestrator', 'executive', 'senior', 'specialist', 'associate']),
  module: z.enum(['matter', 'draft', 'timeline', 'mentor', 'ledger', 'insight', 'connect', 'assurance']),
  promptMode: z.enum(['delta', 'full', 'base']),
  basePrompt: z.literal('legal-base-v1'),
  roleDelta: z.string().min(3),
  romaLevel: z.literal('L5'),
  systemPrompt: z.string().min(200),
  jurisdictionScope: z.object({
    primary: z.array(z.string()).min(1),
    secondary: z.array(z.string()),
    crossBorderEnabled: z.boolean(),
  }),
  slmBinding: SLMBindingSchema,
  capabilities: z.array(z.string()).min(3),
  tools: z.array(z.string()).min(2),
  supportedLanguages: z.array(z.string()).min(5),
  primaryLanguages: z.array(z.string()).min(1),
  quantumReady: QuantumReadySchema,
  guardrails: GuardrailsSchema,
  compliance: ComplianceSchema,
  escalationPath: z.string().min(1),
  supervises: z.array(z.string()),
  security: z.object({
    zeroTrustAccess: z.boolean(),
    encryptionRequired: z.boolean(),
    mTLSEnforced: z.boolean(),
    continuousAuthVerify: z.boolean(),
  }),
  audit: z.object({
    logLevel: z.string(),
    immutableRecord: z.boolean(),
    retentionYears: z.number().min(7),
    socTwoEvidence: z.boolean(),
  }),
  operationModes: z.object({
    autonomous: z.boolean(),
    supervised: z.boolean(),
    humanInLoop: z.boolean(),
    failsafe: z.boolean(),
  }),
  riskControl: z.object({
    requiresHumanApproval: z.boolean(),
    hitlThreshold: z.number().min(0).max(1),
    emergencyKillSwitch: z.boolean(),
  }),
  protocols: z.array(z.string()).min(4),
  skills: z.array(z.string()).min(3),
  sla: z.object({ p50_ms: z.number(), p95_ms: z.number(), p99_ms: z.number() }),
  status: z.enum(['production-ready', 'staging', 'deprecated']),
  grpoEnabled: z.boolean(),
});

export type AgentV3 = z.infer<typeof AgentSchemaV3>;

export const RegistrySchemaV3 = z.object({
  registryVersion: z.string(),
  architecture: z.string(),
  generatedAt: z.string(),
  jurisdiction: z.string(),
  basePrompt: z.literal('legal-base-v1'),
  totalAgents: z.number().int().min(149).max(149),
  validationPassed: z.boolean(),
  modules: z.array(z.string()).length(8),
  romaLevel: z.literal('L5'),
  quantumSecurity: QuantumReadySchema,
  guardrailsDefault: GuardrailsSchema,
  supportedLanguages: z.array(z.string()).min(10),
  agents: z.array(AgentSchemaV3).length(149),
});

export function validateRegistry(data: unknown) {
  return RegistrySchemaV3.safeParse(data);
}

export function validateAgent(data: unknown) {
  return AgentSchemaV3.safeParse(data);
}
