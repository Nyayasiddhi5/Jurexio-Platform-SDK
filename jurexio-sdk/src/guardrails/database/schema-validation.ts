/**
 * MANDATORY: Database Schema Validation
 * Validates ORM models against actual database schema.
 * 
 * Usage:
 *   import { SchemaValidator } from './database/schema-validation.js';
 *   
 *   const errors = await SchemaValidator.validateModelAgainstDB(UserModel, sequelize);
 */

export interface SchemaValidationError {
  type: 'missing_table' | 'missing_column' | 'extra_column' | 'type_mismatch' | 'import_error' | 'missing_tablename';
  table?: string;
  column?: string;
  message: string;
}

export interface ColumnValidationResult {
  valid: boolean;
  warnings: string[];
}

export class SchemaValidator {
  /**
   * Validate a model against the actual database
   * 
   * @param modelClass - Model class (e.g., Sequelize model)
   * @param sequelize - Sequelize instance
   * @returns List of validation errors
   */
  public static async validateModelAgainstDB(
    modelClass: any,
    sequelize: any
  ): Promise<SchemaValidationError[]> {
    const errors: SchemaValidationError[] = [];

    try {
      const queryInterface = sequelize.getQueryInterface();
      const tableName = modelClass.tableName || modelClass.getTableName?.();

      if (!tableName) {
        errors.push({
          type: 'missing_tablename',
          message: 'Model has no tableName defined',
        });
        return errors;
      }

      // Check if table exists
      const tables = await queryInterface.showAllTables();
      if (!tables.includes(tableName)) {
        errors.push({
          type: 'missing_table',
          table: tableName,
          message: `Table '${tableName}' does not exist in database`,
        });
        return errors;
      }

      // Get database columns
      const dbColumns = await queryInterface.describeTable(tableName);
      const dbColumnNames = Object.keys(dbColumns);

      // Get model attributes
      const modelAttributes = modelClass.rawAttributes || modelClass.attributes || {};
      const modelColumnNames = Object.keys(modelAttributes);

      // Check for columns in model but not in database
      for (const colName of modelColumnNames) {
        if (!dbColumnNames.includes(colName)) {
          errors.push({
            type: 'missing_column',
            table: tableName,
            column: colName,
            message: `Column '${colName}' in model but not in database`,
          });
        }
      }

      // Check for extra columns in database
      for (const dbColName of dbColumnNames) {
        if (!modelColumnNames.includes(dbColName)) {
          errors.push({
            type: 'extra_column',
            table: tableName,
            column: dbColName,
            message: `Column '${dbColName}' in database but not in model`,
          });
        }
      }
    } catch (error: any) {
      errors.push({
        type: 'import_error',
        message: `Error validating model: ${error}`,
      });
    }

    return errors;
  }

  /**
   * Validate all models in a module/object
   */
  public static async validateAllModels(
    sequelize: any,
    models: Record<string, any>
  ): Promise<{
    checked: string[];
    errors: SchemaValidationError[];
  }> {
    const results = {
      checked: [] as string[],
      errors: [] as SchemaValidationError[],
    };

    for (const [name, model] of Object.entries(models)) {
      if (model && typeof model === 'object' && (model.tableName || model.getTableName)) {
        const errors = await this.validateModelAgainstDB(model, sequelize);
        results.checked.push(model.tableName || name);
        results.errors.push(...errors);
      }
    }

    return results;
  }
}

/**
 * Database column naming standards
 */
export class ColumnNamingStandards {
  private static readonly STANDARD_PATTERNS: Record<string, RegExp> = {
    primary_key: /^id$/,
    foreign_key: /^[a-z_]+_id$/,
    timestamp: /^(created|updated|deleted)_at$/,
    flag: /^is_[a-z_]+$/,
    count: /^[a-z_]+_count$/,
  };

  private static readonly FORBIDDEN_PATTERNS: RegExp[] = [
    /^[A-Z]/,      // Starts with uppercase
    /[A-Z]/,       // Contains uppercase
    /\s/,          // Contains spaces
    /-/,           // Contains hyphens
  ];

  /**
   * Validate a column name
   */
  public static validateColumnName(name: string): ColumnValidationResult {
    const result: ColumnValidationResult = {
      valid: true,
      warnings: [],
    };

    for (const pattern of this.FORBIDDEN_PATTERNS) {
      if (pattern.test(name)) {
        result.valid = false;
        result.warnings.push(`Column name '${name}' violates naming standards`);
      }
    }

    return result;
  }

  /**
   * Check if column name follows a standard pattern
   */
  public static getColumnType(name: string): string | null {
    for (const [type, pattern] of Object.entries(this.STANDARD_PATTERNS)) {
      if (pattern.test(name)) {
        return type;
      }
    }
    return null;
  }
}

export default SchemaValidator;
