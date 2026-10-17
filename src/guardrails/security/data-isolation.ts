/**
 * MANDATORY: User Data Isolation Enforcement
 * Ensures proper user data isolation in multi-user systems.
 * 
 * Usage:
 *   import { DataIsolationGuardrail, userScoped } from './security/data-isolation.js';
 *   
 *   @userScoped('profile')
 *   async function getProfile(userId: string, currentUser?: User) {
 *     // Function implementation
 *   }
 */

export interface IsolationWarning {
  type: string;
  message: string;
}

export interface UserContext {
  id: string;
  role?: string;
}

export class DataIsolationGuardrail {
  private static readonly DANGEROUS_PATTERNS: RegExp[] = [
    /SELECT.*FROM.*WHERE.*user_id.*=/i,
    /\.filter\([^)]*user_id[^)]*\)/i,
    /\.get\([^)]*user_id[^)]*\)/i,
  ];

  private static readonly REQUIRED_PATTERNS: RegExp[] = [
    /current_user/i,
    /user_context/i,
    /request\.user/i,
  ];

  /**
   * Verify that a database query properly isolates user data
   */
  public static verifyQueryIsolation(
    query: string,
    userIdField: string = 'user_id'
  ): IsolationWarning[] {
    const warnings: IsolationWarning[] = [];

    // Check for missing user filter
    if (!query.toUpperCase().includes('WHERE') && !query.toUpperCase().includes('JOIN')) {
      warnings.push({
        type: 'missing_filter',
        message: 'Query missing WHERE clause - may return all users\' data',
      });
    }

    // Check for hardcoded user IDs
    const hardcodedIdPattern = /user_id\s*=\s*['"]?\d+['"]?/i;
    if (hardcodedIdPattern.test(query)) {
      warnings.push({
        type: 'hardcoded_id',
        message: 'Hardcoded user_id detected - security risk!',
      });
    }

    // Check for proper parameterization
    if (!query.includes('?') && !query.includes('$') && !/:\w+/.test(query)) {
      if (/user_id\s*=\s*['"]/i.test(query)) {
        warnings.push({
          type: 'unparameterized',
          message: 'User ID may not be properly parameterized',
        });
      }
    }

    return warnings;
  }

  /**
   * Verify ORM usage properly isolates user data
   */
  public static verifyORMIsolation(code: string): IsolationWarning[] {
    const warnings: IsolationWarning[] = [];

    for (const pattern of this.DANGEROUS_PATTERNS) {
      if (pattern.test(code)) {
        const hasProperContext = this.REQUIRED_PATTERNS.some(req => req.test(code));

        if (!hasProperContext) {
          warnings.push({
            type: 'isolation_issue',
            message: `Potential isolation issue detected. Ensure user context is properly validated.`,
          });
        }
      }
    }

    return warnings;
  }
}

/**
 * MANDATORY: Decorator for functions that access user-specific resources
 * 
 * Usage:
 *   @userScoped('profile')
 *   async function getProfile(userId: string, currentUser?: User) {
 *     // Function implementation
 *   }
 */
export function userScoped(resourceType: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      // Extract userId from arguments
      const userId = args[0];
      const currentUser = args.find((arg: any) => arg && typeof arg === 'object' && 'id' in arg);

      if (!userId) {
        throw new Error(`userId required for ${resourceType} access`);
      }

      if (currentUser && String(currentUser.id) !== String(userId)) {
        throw new Error(
          `User ${currentUser.id} cannot access ${resourceType} belonging to user ${userId}`
        );
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

/**
 * Base class for models that belong to a specific user
 */
export abstract class UserScopedModel {
  abstract userId: string;
  abstract id: string;

  /**
   * Get records scoped to a specific user
   */
  static async getForUser<T extends UserScopedModel>(
    this: new () => T,
    userId: string,
    filters: Record<string, any> = {}
  ): Promise<T[]> {
    throw new Error('Must implement in subclass');
  }

  /**
   * Get a specific record ensuring it belongs to the user
   */
  static async getByIdForUser<T extends UserScopedModel>(
    this: new () => T,
    recordId: string,
    userId: string
  ): Promise<T | null> {
    throw new Error('Must implement in subclass');
  }

  /**
   * Verify that this record belongs to the specified user
   */
  verifyOwnership(userId: string): void {
    if (this.userId !== userId) {
      throw new Error(
        `Record ${this.id} belongs to user ${this.userId}, not user ${userId}`
      );
    }
  }
}

export default DataIsolationGuardrail;
