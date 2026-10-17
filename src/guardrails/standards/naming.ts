/**
 * MANDATORY: Naming Convention Standards
 * NO EXCEPTIONS - All code must follow these standards.
 * 
 * Usage:
 *   import { NamingStandards } from './standards/naming.js';
 *   
 *   const result = NamingStandards.validateName('UserManager', 'class');
 *   if (!result.valid) {
 *     console.log(result.error);
 *   }
 */

export interface NamingValidationResult {
  valid: boolean;
  error?: string;
  convention?: string;
  expected?: string;
  example?: string;
}

export type NameType = 
  | 'module' 
  | 'package' 
  | 'class' 
  | 'function' 
  | 'method' 
  | 'variable' 
  | 'constant'
  | 'table'
  | 'column'
  | 'index'
  | 'endpoint';

export class NamingStandards {
  private static readonly CONVENTIONS: Record<NameType, {
    pattern: RegExp;
    example: string;
    description: string;
  }> = {
    // TypeScript/JavaScript naming
    module: {
      pattern: /^[a-z][a-z0-9_]*$/,
      example: 'user_manager',
      description: 'snake_case, lowercase with underscores',
    },
    package: {
      pattern: /^[a-z][a-z0-9_]*$/,
      example: 'user_management',
      description: 'snake_case, lowercase with underscores',
    },
    class: {
      pattern: /^[A-Z][a-zA-Z0-9]*$/,
      example: 'UserManager',
      description: 'PascalCase, starts with uppercase',
    },
    function: {
      pattern: /^[a-z][a-z0-9_]*$/,
      example: 'get_user_by_id',
      description: 'snake_case, lowercase with underscores',
    },
    method: {
      pattern: /^[a-z][a-z0-9_]*$/,
      example: 'validate_password',
      description: 'snake_case, lowercase with underscores',
    },
    variable: {
      pattern: /^[a-z][a-z0-9_]*$/,
      example: 'user_count',
      description: 'snake_case, lowercase with underscores',
    },
    constant: {
      pattern: /^[A-Z][A-Z0-9_]*$/,
      example: 'MAX_RETRY_COUNT',
      description: 'UPPER_SNAKE_CASE',
    },
    
    // Database naming
    table: {
      pattern: /^[a-z][a-z0-9_]*s$/,
      example: 'users',
      description: 'snake_case, plural, lowercase',
    },
    column: {
      pattern: /^[a-z][a-z0-9_]*$/,
      example: 'created_at',
      description: 'snake_case, lowercase',
    },
    index: {
      pattern: /^idx_[a-z][a-z0-9_]*$/,
      example: 'idx_user_email',
      description: 'Prefix with idx_, snake_case',
    },
    
    // API naming
    endpoint: {
      pattern: /^\/[a-z][a-z0-9-]*(\/[a-z][a-z0-9-]*)*$/,
      example: '/users/{id}/profile',
      description: 'kebab-case, lowercase with hyphens',
    },
  };

  /**
   * Validate a name against conventions
   */
  public static validateName(name: string, nameType: NameType): NamingValidationResult {
    const convention = this.CONVENTIONS[nameType];
    if (!convention) {
      return {
        valid: false,
        error: `Unknown name type: ${nameType}`,
      };
    }

    if (convention.pattern.test(name)) {
      return {
        valid: true,
        convention: convention.description,
      };
    } else {
      return {
        valid: false,
        error: `'${name}' does not match ${nameType} convention`,
        expected: convention.description,
        example: convention.example,
      };
    }
  }

  /**
   * Suggest a corrected name
   */
  public static suggestCorrection(name: string, nameType: NameType): string | null {
    if (nameType === 'module' || nameType === 'function' || nameType === 'variable') {
      return name.toLowerCase().replace(/-/g, '_').replace(/\s/g, '_');
    } else if (nameType === 'class') {
      return name
        .replace(/_/g, ' ')
        .replace(/-/g, ' ')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join('');
    } else if (nameType === 'constant') {
      return name.toUpperCase().replace(/-/g, '_').replace(/\s/g, '_');
    }
    return null;
  }

  /**
   * Get all conventions
   */
  public static getConventions(): Record<NameType, { example: string; description: string }> {
    const result = {} as Record<NameType, { example: string; description: string }>;
    for (const [type, config] of Object.entries(this.CONVENTIONS)) {
      result[type as NameType] = {
        example: config.example,
        description: config.description,
      };
    }
    return result;
  }
}

export default NamingStandards;
