/**
 * MANDATORY: Session Audit and Validation
 * Validates session data for compliance and security.
 * 
 * Usage:
 *   import { SessionAuditor, SessionRequirement } from './session/audit.js';
 *   
 *   const errors = SessionAuditor.validateSession(sessionData);
 *   const securityIssues = SessionAuditor.auditSessionSecurity(sessionData);
 */

export interface SessionRequirement {
  name: string;
  required: boolean;
  type: 'string' | 'integer' | 'datetime' | 'boolean';
  maxLength?: number;
  encrypted: boolean;
  ttlSeconds?: number;
}

export interface SessionValidationError {
  type: 'missing_required' | 'type_mismatch' | 'length_exceeded' | 'unexpected_field';
  field: string;
  message: string;
}

export interface SessionSecurityIssue {
  type: 'old_session' | 'sensitive_data' | 'size_exceeded' | 'persistence_warning' | 'unknown_platform';
  field?: string;
  message: string;
}

// MANDATORY: Define all session variables
export const SESSION_SCHEMA: Record<string, SessionRequirement> = {
  user_id: {
    name: 'user_id',
    required: true,
    type: 'integer',
    encrypted: true,
  },
  session_id: {
    name: 'session_id',
    required: true,
    type: 'string',
    maxLength: 64,
    encrypted: false,
  },
  created_at: {
    name: 'created_at',
    required: true,
    type: 'datetime',
    encrypted: false,
  },
  last_activity: {
    name: 'last_activity',
    required: true,
    type: 'datetime',
    encrypted: false,
  },
  ip_address: {
    name: 'ip_address',
    required: false,
    type: 'string',
    maxLength: 45,
    encrypted: true,
  },
};

export class SessionAuditor {
  /**
   * Validate session data against schema
   */
  public static validateSession(sessionData: Record<string, any>): SessionValidationError[] {
    const errors: SessionValidationError[] = [];

    // Check required fields
    for (const [name, requirement] of Object.entries(SESSION_SCHEMA)) {
      if (requirement.required && !(name in sessionData)) {
        errors.push({
          type: 'missing_required',
          field: name,
          message: `Required session field '${name}' is missing`,
        });
      }
    }

    // Validate existing fields
    for (const [name, value] of Object.entries(sessionData)) {
      if (name in SESSION_SCHEMA) {
        const requirement = SESSION_SCHEMA[name];

        // Type validation
        if (requirement.type === 'integer' && typeof value !== 'number') {
          errors.push({
            type: 'type_mismatch',
            field: name,
            message: `Expected integer, got ${typeof value}`,
          });
        }

        if (requirement.type === 'string' && typeof value !== 'string') {
          errors.push({
            type: 'type_mismatch',
            field: name,
            message: `Expected string, got ${typeof value}`,
          });
        }

        // Length validation
        if (requirement.maxLength && String(value).length > requirement.maxLength) {
          errors.push({
            type: 'length_exceeded',
            field: name,
            message: `Length exceeds maximum of ${requirement.maxLength}`,
          });
        }
      }
    }

    // Check for unexpected fields
    for (const name of Object.keys(sessionData)) {
      if (!(name in SESSION_SCHEMA)) {
        errors.push({
          type: 'unexpected_field',
          field: name,
          message: `Unexpected session field '${name}'`,
        });
      }
    }

    return errors;
  }

  /**
   * Audit session for security issues
   */
  public static auditSessionSecurity(sessionData: Record<string, any>): SessionSecurityIssue[] {
    const issues: SessionSecurityIssue[] = [];

    // Check session age
    if ('created_at' in sessionData) {
      const created = sessionData.created_at;
      if (created) {
        try {
          const createdDate = typeof created === 'string' ? new Date(created) : created;
          const ageMs = Date.now() - createdDate.getTime();
          const ageDays = ageMs / (1000 * 60 * 60 * 24);

          if (ageDays > 7) {
            issues.push({
              type: 'old_session',
              message: `Session is ${Math.floor(ageDays)} days old`,
            });
          }
        } catch {
          // Invalid date format
        }
      }
    }

    // Check for sensitive data
    const sensitivePatterns = ['password', 'secret', 'token', 'key', 'credential'];
    for (const name of Object.keys(sessionData)) {
      if (sensitivePatterns.some(pattern => name.toLowerCase().includes(pattern))) {
        issues.push({
          type: 'sensitive_data',
          field: name,
          message: `Session contains potentially sensitive field '${name}'`,
        });
      }
    }

    return issues;
  }

  /**
   * Check if session is valid overall
   */
  public static isValidSession(sessionData: Record<string, any>): boolean {
    const errors = this.validateSession(sessionData);
    return errors.length === 0;
  }
}

/**
 * Handle session data across different platforms
 */
export class CrossPlatformSession {
  private static readonly PLATFORM_LIMITS: Record<string, {
    maxSessionSize: number;
    persistentStorage: boolean;
    encryptionRequired: boolean;
  }> = {
    replit: {
      maxSessionSize: 4096,
      persistentStorage: false,
      encryptionRequired: true,
    },
    heroku: {
      maxSessionSize: 4096,
      persistentStorage: true,
      encryptionRequired: true,
    },
    aws: {
      maxSessionSize: 4096,
      persistentStorage: true,
      encryptionRequired: true,
    },
  };

  /**
   * Validate session compatibility with target platform
   */
  public static validatePlatformCompatibility(
    sessionData: Record<string, any>,
    targetPlatform: string
  ): SessionSecurityIssue[] {
    const issues: SessionSecurityIssue[] = [];

    const limits = this.PLATFORM_LIMITS[targetPlatform];
    if (!limits) {
      issues.push({
        type: 'unknown_platform',
        message: `Unknown platform: ${targetPlatform}`,
      });
      return issues;
    }

    // Check size
    const jsonData = JSON.stringify(sessionData);
    if (jsonData.length > limits.maxSessionSize) {
      issues.push({
        type: 'size_exceeded',
        message: `Session size ${jsonData.length} exceeds limit of ${limits.maxSessionSize}`,
      });
    }

    // Check persistence requirements
    if (!limits.persistentStorage) {
      for (const key of Object.keys(sessionData)) {
        if (['user_id', 'preferences'].includes(key)) {
          issues.push({
            type: 'persistence_warning',
            field: key,
            message: `'${key}' should be persisted as platform has no persistent storage`,
          });
        }
      }
    }

    return issues;
  }

  /**
   * Get platform limits
   */
  public static getPlatformLimits(platform: string): {
    maxSessionSize: number;
    persistentStorage: boolean;
    encryptionRequired: boolean;
  } | null {
    return this.PLATFORM_LIMITS[platform] || null;
  }
}

export default SessionAuditor;
