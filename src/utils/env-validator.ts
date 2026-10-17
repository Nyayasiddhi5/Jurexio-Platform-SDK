import { createLogger } from './logger.js';
import { resolveRedisTcpUrl, CANONICAL_REDIS_VAR } from './redis-tcp-url.js';

const logger = createLogger('env-validator');

/**
 * NYV Environment Validator — startup-blocking secret validation
 * Runs as the FIRST executable line in src/index.ts before any service initialises.
 *
 * GUARDRAIL: Every new required secret MUST be added to REQUIRED_SECRETS below.
 * Never access process.env for secrets without this validator running first.
 *
 * @file src/utils/env-validator.ts
 */

interface SecretSpec {
  key: string;
  minLength?: number;
  forbidden?: string[];
  required: boolean;
  description: string;
}

const REQUIRED_SECRETS: SecretSpec[] = [
  {
    key: 'DATABASE_URL',
    minLength: 20,
    required: true,
    description: 'PostgreSQL connection string',
  },
  {
    key: 'JWT_SECRET',
    minLength: 32,
    forbidden: [
      'dev', 'test', 'secret', 'password', 'nyayavigya',
      'jwt-secret-dev', 'change-me', 'changeme', '123456',
    ],
    required: false,
    description: 'JWT signing secret (min 32 chars) — REQUIRED in production',
  },
  {
    key: 'NYV_JWT_REFRESH_SECRET',
    minLength: 32,
    required: false,
    description: 'JWT refresh token signing secret',
  },
  {
    key: 'AI_INTEGRATIONS_OPENAI_API_KEY',
    minLength: 10,
    required: false,
    description: 'OpenAI API key for AI patterns',
  },
  {
    key: 'AI_INTEGRATIONS_OPENROUTER_API_KEY',
    minLength: 10,
    required: false,
    description: 'OpenRouter API key for multi-model routing (AI_INTEGRATIONS_ prefix)',
  },
  {
    key: 'OPENROUTER_API_KEY',
    minLength: 10,
    required: false,
    description: 'OpenRouter API key (short name — accepted by llm-config.ts)',
  },
];

interface ValidationResult {
  errors: string[];
  warnings: string[];
}

function validateSecret(spec: SecretSpec): { error: string | null; warning: string | null } {
  const value = process.env[spec.key];

  if (!value || value.trim().length === 0) {
    const msg = `${spec.key}: missing — ${spec.description}`;
    return spec.required ? { error: msg, warning: null } : { error: null, warning: msg };
  }

  if (spec.minLength && value.length < spec.minLength) {
    const msg = `${spec.key}: too short (${value.length} chars, min ${spec.minLength}) — ${spec.description}`;
    return spec.required ? { error: msg, warning: null } : { error: null, warning: msg };
  }

  if (spec.forbidden) {
    const lower = value.toLowerCase();
    const hit = spec.forbidden.find(f => lower.includes(f.toLowerCase()));
    if (hit) {
      return {
        error: `${spec.key}: INSECURE VALUE DETECTED (contains '${hit}'). Regenerate: node -e "process.stdout.write(require('crypto').randomBytes(64).toString('base64')+'\\n')"`,
        warning: null,
      };
    }
  }

  return { error: null, warning: null };
}

export function validateEnv(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const spec of REQUIRED_SECRETS) {
    const { error, warning } = validateSecret(spec);
    if (error) errors.push(error);
    if (warning) warnings.push(warning);
  }

  const isProduction = process.env.NODE_ENV === 'production';

  // LLM key check — always warn (not just prod) if no key at all
  const hasLlmKey =
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||
    process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.OPENAI_API_KEY;
  if (!hasLlmKey) {
    warnings.push(
      'No LLM API key set. Set OPENROUTER_API_KEY (preferred) or OPENAI_API_KEY. ' +
      'All 22 AI patterns will return simulated responses until a key is configured.'
    );
  }

  // Redis check — NV-SECRETS-001: delegate to canonical resolver. Any legacy
  // alias resolved here will trigger the one-shot deprecation warning inside
  // resolveRedisTcpUrl() so operators see the migration nag exactly once.
  const r = resolveRedisTcpUrl();
  if (isProduction && !r.enabled) {
    errors.push(
      `${CANONICAL_REDIS_VAR}: ${r.reason ?? 'missing'} — Redis is required for production ` +
      `rate limiting (multi-pod safe). Provide a rediss:// URL as ${CANONICAL_REDIS_VAR}.`,
    );
  } else if (!r.enabled && r.reason && r.reason.includes('REST')) {
    warnings.push(
      `${r.reason}. Rate limiting will use in-memory fallback until ${CANONICAL_REDIS_VAR} is set.`,
    );
  }

  if (process.env.NYV_LLM_COST_PROFILE) {
    const v = String(process.env.NYV_LLM_COST_PROFILE).trim().toLowerCase();
    if (v === 'cost-first' || v === 'production-cost' || v === 'production_cost') {
      warnings.push(
        'NYV_LLM_COST_PROFILE is active: Bedrock prefers ap-south-1 and Nova/Haiku-first ladders. ' +
          'Ensure this is intentional for the target environment (not jrx-staging demo unless piloting).',
      );
    } else {
      warnings.push(
        `NYV_LLM_COST_PROFILE=${process.env.NYV_LLM_COST_PROFILE} is unrecognized; ` +
          'use cost-first or production-cost to enable the cost profile.',
      );
    }
  }

  return { errors, warnings };
}

export function runEnvValidation(): void {
  const { errors, warnings } = validateEnv();

  const isProduction = process.env.NODE_ENV === 'production';

  if (warnings.length > 0) {
    for (const w of warnings) {
      process.stderr.write(`[EnvValidator] ⚠️  WARNING: ${w}\n`);
    }
  }

  if (errors.length > 0) {
    process.stderr.write('[EnvValidator] ❌ STARTUP BLOCKED — secret validation failed:\n');
    for (const e of errors) {
      process.stderr.write(`  • ${e}\n`);
    }
    process.stderr.write('[EnvValidator] Fix: set the above secrets in Replit Secrets panel, then restart.\n');
    process.stderr.write('[EnvValidator] Generate secrets: node -e "process.stdout.write(require(\'crypto\').randomBytes(64).toString(\'base64\')+\'\\n\')"\n');
    if (isProduction) {
      process.exit(1);
    }
  } else {
    process.stderr.write('[EnvValidator] ✅ Environment validated\n');
  }
}
