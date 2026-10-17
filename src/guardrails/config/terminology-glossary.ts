/**
 * MANDATORY: Standardized Terminology Glossary
 * Use ONLY these standardized terms throughout the codebase.
 * Any deviation requires architecture review approval.
 */

export interface TermDefinition {
  preferred: string;
  deprecated: string[];
  usage: string;
}

export type Domain = 'user_management' | 'task_management' | 'data_storage' | 'session_management';

/**
 * Standardized terminology glossary
 */
export const TERMINOLOGY_GLOSSARY: Record<Domain, Record<string, TermDefinition>> = {
  user_management: {
    user: {
      preferred: 'user',
      deprecated: ['account', 'profile', 'member', 'person'],
      usage: 'Represents a system user account',
    },
    user_id: {
      preferred: 'user_id',
      deprecated: ['uid', 'userId', 'account_id', 'member_id'],
      usage: 'Unique identifier for a user',
    },
    authenticate: {
      preferred: 'authenticate',
      deprecated: ['login', 'signin', 'auth', 'verify_credentials'],
      usage: 'Process of verifying user identity',
    },
  },
  task_management: {
    task: {
      preferred: 'task',
      deprecated: ['job', 'work', 'action', 'operation', 'activity'],
      usage: 'Represents a unit of work to be performed',
    },
    task_id: {
      preferred: 'task_id',
      deprecated: ['tid', 'job_id', 'work_id'],
      usage: 'Unique identifier for a task',
    },
    execute: {
      preferred: 'execute',
      deprecated: ['run', 'perform', 'process', 'do'],
      usage: 'To carry out a task',
    },
  },
  data_storage: {
    persist: {
      preferred: 'persist',
      deprecated: ['save', 'store', 'write', 'commit'],
      usage: 'Save data to persistent storage',
    },
    retrieve: {
      preferred: 'retrieve',
      deprecated: ['get', 'fetch', 'load', 'read'],
      usage: 'Read data from storage',
    },
    configuration: {
      preferred: 'configuration',
      deprecated: ['config', 'settings', 'options', 'prefs'],
      usage: 'Application configuration data',
    },
  },
  session_management: {
    session: {
      preferred: 'session',
      deprecated: ['context', 'state', 'connection'],
      usage: 'User session data',
    },
    session_id: {
      preferred: 'session_id',
      deprecated: ['sid', 'sessionId', 'token'],
      usage: 'Unique session identifier',
    },
  },
};

/**
 * Get the preferred term for a concept
 */
export function getPreferredTerm(domain: Domain, concept: string): string {
  if (domain in TERMINOLOGY_GLOSSARY) {
    if (concept in TERMINOLOGY_GLOSSARY[domain]) {
      return TERMINOLOGY_GLOSSARY[domain][concept].preferred;
    }
  }
  return concept;
}

export interface TermViolation {
  deprecated: string;
  preferred: string;
  concept: string;
}

/**
 * Validate that only preferred terms are used
 */
export function validateTermUsage(code: string, domain: Domain): TermViolation[] {
  const violations: TermViolation[] = [];

  if (!(domain in TERMINOLOGY_GLOSSARY)) {
    return violations;
  }

  for (const [concept, terms] of Object.entries(TERMINOLOGY_GLOSSARY[domain])) {
    for (const deprecated of terms.deprecated) {
      if (code.toLowerCase().includes(deprecated.toLowerCase())) {
        violations.push({
          deprecated,
          preferred: terms.preferred,
          concept,
        });
      }
    }
  }

  return violations;
}

/**
 * Print the terminology glossary
 */
export function printGlossary(): void {
  for (const [domain, concepts] of Object.entries(TERMINOLOGY_GLOSSARY)) {
    console.log(`\n${domain.toUpperCase()}:`);
    for (const [concept, info] of Object.entries(concepts)) {
      console.log(`  ${concept}:`);
      console.log(`    Preferred: ${info.preferred}`);
      console.log(`    Deprecated: ${info.deprecated.join(', ')}`);
      console.log(`    Usage: ${info.usage}`);
    }
  }
}

/**
 * Get all deprecated terms for a domain
 */
export function getDeprecatedTerms(domain: Domain): string[] {
  const deprecated: string[] = [];
  if (domain in TERMINOLOGY_GLOSSARY) {
    for (const terms of Object.values(TERMINOLOGY_GLOSSARY[domain])) {
      deprecated.push(...terms.deprecated);
    }
  }
  return deprecated;
}

export default TERMINOLOGY_GLOSSARY;
