import { createLogger } from '../utils/logger.js';

const logger = createLogger('environment-validator');

/**
 * Environment Validator for Jurexio Legal SDK
 * Validates all required environment variables at server startup
 */

interface ValidationResult {
  isValid: boolean;
  warnings: string[];
  errors: string[];
}

interface EnvKeyConfig {
  name: string;
  required: 'critical' | 'important' | 'optional';
  description: string;
  validator?: (value: string) => boolean;
}

const ENV_KEYS: EnvKeyConfig[] = [
  // CRITICAL keys - server won't start without these in production
  {
    name: 'DATABASE_URL',
    required: 'critical',
    description: 'PostgreSQL connection string',
    validator: (value) => value.startsWith('postgresql://') || value.startsWith('postgres://')
  },
  {
    name: 'JWT_SECRET',
    required: 'critical',
    description: 'Secret key for JWT token generation',
    validator: (value) => value.length >= 64
  },

  // IMPORTANT keys - warnings, degraded functionality
  {
    name: 'OPENROUTER_API_KEY',
    required: 'important',
    description: 'OpenRouter API key for LLM calls'
  },
  {
    name: 'OPENAI_API_KEY',
    required: 'important',
    description: 'OpenAI API key for OCR and document intelligence'
  },
  {
    name: 'SARVAM_API_KEY',
    required: 'important',
    description: 'Sarvam AI key for 22 Indian language translation'
  },

  // IMPORTANT (Production) - SMTP for email delivery
  {
    name: 'SMTP_HOST',
    required: 'important',
    description: 'SMTP server host for email delivery'
  },
  {
    name: 'SMTP_USER',
    required: 'important',
    description: 'SMTP authentication username'
  },
  {
    name: 'SMTP_PASS',
    required: 'important',
    description: 'SMTP authentication password'
  },
  {
    name: 'SMTP_FROM_EMAIL',
    required: 'important',
    description: 'Email sender address (e.g. noreply@nyayasiddhi.com)'
  },

  // OPTIONAL keys - info-level, features disabled
  {
    name: 'RAZORPAY_KEY_ID',
    required: 'optional',
    description: 'Razorpay public key for payment processing'
  },
  {
    name: 'RAZORPAY_KEY_SECRET',
    required: 'optional',
    description: 'Razorpay secret key for payment processing'
  },
  {
    name: 'RAZORPAY_WEBHOOK_SECRET',
    required: 'optional',
    description: 'Razorpay webhook verification secret'
  },
  {
    name: 'CORS_ORIGINS',
    required: 'optional',
    description: 'Comma-separated allowed CORS origins (defaults to localhost in dev)'
  },
  {
    name: 'ELEVENLABS_API_KEY',
    required: 'optional',
    description: 'ElevenLabs API key for voice synthesis'
  },
  {
    name: 'PERPLEXITY_API_KEY',
    required: 'optional',
    description: 'Perplexity API key for web search'
  },
  {
    name: 'TAVILY_API_KEY',
    required: 'optional',
    description: 'Tavily API key for web search provider'
  },
  {
    name: 'SERPER_API_KEY',
    required: 'optional',
    description: 'Serper API key for web search provider'
  },
  {
    name: 'STRIPE_SECRET_KEY',
    required: 'optional',
    description: 'Stripe secret key for billing'
  },
  {
    name: 'GOOGLE_DRIVE_API_KEY',
    required: 'optional',
    description: 'Google Drive API key for Drive integration'
  }
];

function getEnvironment(): string {
  return process.env.NODE_ENV || 'development';
}

function formatTable(
  keys: EnvKeyConfig[],
  statusMap: Map<string, { present: boolean; valid: boolean; error?: string }>
): string {
  const env = getEnvironment();
  const rows: string[] = [];

  rows.push('');
  rows.push('╔════════════════════════════════════════════════════════════════════════════════╗');
  rows.push(`║                    Environment Variables Audit [${env.toUpperCase()}]                    ║`);
  rows.push('╠════════════════════════════════════════════════════════════════════════════════╣');
  rows.push('║ STATUS │ KEY                         │ TYPE        │ VALUE                       ║');
  rows.push('╠════════╪═════════════════════════════╪═════════════╪═════════════════════════════╣');

  for (const key of keys) {
    const status = statusMap.get(key.name);
    if (!status) continue;

    const statusIcon = status.present ? (status.valid ? '✓' : '⚠') : '✗';
    const valueStr = status.present ? (status.valid ? 'SET' : 'INVALID') : 'MISSING';
    const typeStr = key.required.padEnd(11);
    const keyStr = key.name.padEnd(27);

    rows.push(`║ ${statusIcon}      │ ${keyStr} │ ${typeStr} │ ${valueStr.padEnd(29)} ║`);
  }

  rows.push('╚════════╧═════════════════════════════╧═════════════╧═════════════════════════════╝');
  rows.push('');

  return rows.join('\n');
}

export function validateEnvironment(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const env = getEnvironment();
  const statusMap = new Map<string, { present: boolean; valid: boolean; error?: string }>();

  for (const keyConfig of ENV_KEYS) {
    const value = process.env[keyConfig.name];
    const present = !!value;

    let valid = present;
    let error: string | undefined;

    if (present && keyConfig.validator) {
      valid = keyConfig.validator(value!);
      if (!valid) {
        error = `Invalid format for ${keyConfig.name}`;
      }
    }

    statusMap.set(keyConfig.name, { present, valid, error });

    // Validate based on environment and requirement level
    if (!present) {
      const message = `${keyConfig.name} (${keyConfig.description}) is missing`;

      if (keyConfig.required === 'critical') {
        if (env === 'production') {
          errors.push(`CRITICAL: ${message}`);
        } else {
          warnings.push(`⚠️ WARNING (DEV): ${message}`);
        }
      } else if (keyConfig.required === 'important') {
        warnings.push(`⚠️ IMPORTANT: ${message} - ${keyConfig.description} will not work`);
      } else if (keyConfig.required === 'optional') {
        warnings.push(`ℹ️ OPTIONAL: ${message} - feature will be disabled`);
      }
    } else if (!valid) {
      const message = `${keyConfig.name}: ${error}`;

      if (keyConfig.required === 'critical') {
        if (env === 'production') {
          errors.push(`CRITICAL: ${message}`);
        } else {
          warnings.push(`⚠️ WARNING (DEV): ${message}`);
        }
      } else if (keyConfig.required === 'important') {
        warnings.push(`⚠️ IMPORTANT: ${message}`);
      } else if (keyConfig.required === 'optional') {
        warnings.push(`ℹ️ OPTIONAL: ${message}`);
      }
    }
  }

  // Special validation for JWT_SECRET in production
  const jwtSecret = process.env.JWT_SECRET;
  if (jwtSecret === 'development-secret-key-change-in-production') {
    const message = 'JWT_SECRET is using the default development secret - SECURITY RISK in production';
    if (env === 'production') {
      errors.push(`CRITICAL: ${message}`);
    } else {
      warnings.push(`⚠️ WARNING (DEV): ${message}`);
    }
  }

  // Log the audit table
  logger.info(formatTable(ENV_KEYS, statusMap));

  // Log summary
  if (errors.length > 0) {
    logger.info(`❌ Validation Failed: ${errors.length} critical issue(s)`);
    errors.forEach((error) => logger.info(`   ${error}`));
    logger.info('');
  }

  if (warnings.length > 0) {
    logger.info(`⚠️ Validation Warnings: ${warnings.length} issue(s)`);
    warnings.forEach((warning) => logger.info(`   ${warning}`));
    logger.info('');
  }

  if (errors.length === 0 && warnings.length === 0) {
    logger.info('✅ All environment variables are properly configured');
    logger.info('');
  }

  const isValid = errors.length === 0 || (errors.length > 0 && env === 'development');

  return {
    isValid,
    warnings,
    errors
  };
}
